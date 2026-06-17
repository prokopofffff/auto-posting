// Draft publishing, ported from src/server/publish.ts. Decrypts tokens with the
// cross-runtime crypto, fans out to Telegram/LinkedIn via fetch, records Post
// rows, moderates, and flips the Draft to PUBLISHED/FAILED. Logic is unchanged;
// only import paths differ.
import { selectDraftWithProject, supabaseAdmin, unwrap } from "./supabase.ts";
import { decrypt } from "./crypto.ts";
import { buildPostUrl, sendMessage } from "./telegram.ts";
import { createPost as createLinkedInPost } from "./linkedin.ts";
import { getValidLinkedInAccessToken } from "./linkedin-tokens.ts";
import { moderate } from "./moderation.ts";
import type { ResolvedModel } from "./ai-credentials.ts";
import { withRetry } from "./retry.ts";
import type { ConnectedAccount, Platform } from "./types.ts";

function recordPublishError(input: {
  projectId: string;
  draftId: string;
  platform: Platform;
  language: string;
  content?: string;
  error: string;
}) {
  return unwrap(
    supabaseAdmin.from("Post").insert({
      projectId: input.projectId,
      draftId: input.draftId,
      platform: input.platform,
      language: input.language,
      content: input.content ?? "",
      error: input.error,
    }),
  );
}

export type DraftContent = Record<string, string>; // lang -> text
export type DraftContentByPlatform = Partial<Record<Platform, DraftContent>>;

function pickContent(content: DraftContent): { lang: string; text: string } | null {
  const en = content.en;
  if (en) return { lang: "en", text: en };
  const first = Object.entries(content)[0];
  if (!first) return null;
  return { lang: first[0], text: first[1] };
}

function pickPlatformContent(
  byPlatform: DraftContentByPlatform | null,
  byLang: DraftContent,
  platform: Platform,
): { lang: string; text: string } | null {
  const platformContent = byPlatform?.[platform];
  if (platformContent) {
    const picked = pickContent(platformContent);
    if (picked) return picked;
  }
  return pickContent(byLang);
}

async function publishToTelegram(
  projectId: string,
  draftId: string,
  conn: ConnectedAccount,
  content: DraftContent,
  contentByPlatform: DraftContentByPlatform | null,
) {
  if (!conn.accessToken) return null;
  const picked = pickPlatformContent(contentByPlatform, content, "TELEGRAM");
  if (!picked) return null;
  const token = await decrypt(conn.accessToken);
  try {
    const res = await withRetry(() =>
      sendMessage(token, conn.externalId, picked.text, {
        disableWebPagePreview: false,
      }),
    );
    const url = buildPostUrl(res.chat, res.message_id);
    await unwrap(
      supabaseAdmin.from("Post").insert({
        projectId,
        draftId,
        platform: "TELEGRAM",
        language: picked.lang,
        content: picked.text,
        externalId: String(res.message_id),
        externalUrl: url,
      }),
    );
    return { platform: "TELEGRAM" as const, language: picked.lang, url };
  } catch (e) {
    await recordPublishError({
      projectId,
      draftId,
      platform: "TELEGRAM",
      language: picked.lang,
      content: picked.text,
      error: (e as Error).message,
    });
    return null;
  }
}

async function publishToLinkedIn(
  projectId: string,
  draftId: string,
  conn: ConnectedAccount,
  content: DraftContent,
  contentByPlatform: DraftContentByPlatform | null,
) {
  if (!conn.accessToken) return null;
  const picked = pickPlatformContent(contentByPlatform, content, "LINKEDIN");
  if (!picked) return null;
  let token: string;
  try {
    token = await getValidLinkedInAccessToken(conn);
  } catch (e) {
    await recordPublishError({
      projectId,
      draftId,
      platform: "LINKEDIN",
      language: picked.lang,
      error: (e as Error).message,
    });
    return null;
  }
  try {
    const res = await withRetry(() =>
      createLinkedInPost(token, conn.externalId, picked.text),
    );
    await unwrap(
      supabaseAdmin.from("Post").insert({
        projectId,
        draftId,
        platform: "LINKEDIN",
        language: picked.lang,
        content: picked.text,
        externalId: res.id || null,
        externalUrl: res.url,
      }),
    );
    return { platform: "LINKEDIN" as const, language: picked.lang, url: res.url };
  } catch (e) {
    await recordPublishError({
      projectId,
      draftId,
      platform: "LINKEDIN",
      language: picked.lang,
      content: picked.text,
      error: (e as Error).message,
    });
    return null;
  }
}

export async function publishDraft(
  draftId: string,
  // Optional pre-resolved client from the caller (autopublish) so moderation
  // doesn't re-resolve the project's credential.
  resolved?: ResolvedModel,
): Promise<
  | { ok: true; posts: Array<{ platform: string; language: string; url: string | null }> }
  | { ok: false; error: string }
> {
  const { data: draft } = await selectDraftWithProject(supabaseAdmin, draftId);
  if (!draft) return { ok: false, error: "Draft not found." };
  if (draft.status === "PUBLISHED") return { ok: false, error: "Already published." };

  const content = draft.contentByLang as DraftContent;
  const contentByPlatform =
    (draft.contentByPlatform as DraftContentByPlatform | null) ?? null;

  const settings = draft.project.settings;
  if (settings) {
    const allTexts = [
      ...Object.values(content),
      ...Object.values(contentByPlatform ?? {}).flatMap((v) => Object.values(v ?? {})),
    ];
    const mod = await moderate({
      texts: allTexts,
      bannedWords: settings.bannedWords ?? [],
      moderationEnabled: settings.moderationEnabled,
      projectId: draft.projectId,
    }, resolved);
    if (!mod.allowed) {
      await recordPublishError({
        projectId: draft.projectId,
        draftId: draft.id,
        platform: draft.targets?.[0] ?? "TELEGRAM",
        language: Object.keys(content)[0] ?? "en",
        error: `Blocked by safety check: ${mod.reason}`,
      });
      await unwrap(
        supabaseAdmin
          .from("Draft")
          .update({ status: "FAILED" })
          .eq("id", draft.id),
      );
      return { ok: false, error: `Blocked by safety check: ${mod.reason}` };
    }
  }

  const posts: Array<{ platform: string; language: string; url: string | null }> = [];

  for (const platform of draft.targets ?? []) {
    const conns = draft.project.connectedAccounts.filter((c) => c.platform === platform);
    for (const conn of conns) {
      const pub =
        platform === "TELEGRAM"
          ? await publishToTelegram(draft.projectId, draft.id, conn, content, contentByPlatform)
          : platform === "LINKEDIN"
          ? await publishToLinkedIn(draft.projectId, draft.id, conn, content, contentByPlatform)
          : null;
      if (pub) posts.push(pub);
    }
  }

  // Derive status from ALL post rows: PUBLISHED only when something shipped and
  // nothing errored. A partial failure (e.g. Telegram ok, LinkedIn errored)
  // stays FAILED so it shows up in the app's Failed filter and stays retryable.
  const allPosts = await unwrap(
    supabaseAdmin.from("Post").select("error").eq("draftId", draft.id),
  );
  const anyError = allPosts.some((p: { error: string | null }) => p.error);
  const anySuccess = allPosts.some((p: { error: string | null }) => !p.error);
  await unwrap(
    supabaseAdmin
      .from("Draft")
      .update({ status: anySuccess && !anyError ? "PUBLISHED" : "FAILED" })
      .eq("id", draft.id),
  );

  if (posts.length === 0) return { ok: false, error: "No posts were published. Check connections." };
  return { ok: true, posts };
}
