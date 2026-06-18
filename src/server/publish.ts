import { supabaseAdmin } from "@/lib/supabase/service";
import { selectDraftWithProject, unwrap } from "@/lib/supabase/queries";
import { decrypt } from "@/lib/crypto";
import { buildPostUrl, sendMessage, sendPhoto, TELEGRAM_CAPTION_LIMIT } from "@/lib/telegram";
import { createPost as createLinkedInPost, uploadImage as uploadLinkedInImage } from "@/lib/linkedin";
import { getValidLinkedInAccessToken } from "@/server/linkedin-tokens";
import { invokeEdge } from "@/server/edge";
import { withRetry } from "@/lib/retry";
import type { ConnectedAccount, Platform } from "@/lib/types";

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
  imageUrl: string | null,
) {
  if (!conn.accessToken) return null;
  const picked = pickPlatformContent(contentByPlatform, content, "TELEGRAM");
  if (!picked) return null;
  const token = await decrypt(conn.accessToken);
  try {
    // With a photo: send it with the text as a caption when it fits, otherwise
    // send the photo uncaptioned and the full text as a follow-up message.
    const captionFits = picked.text.length <= TELEGRAM_CAPTION_LIMIT;
    const res = await withRetry(() =>
      imageUrl
        ? sendPhoto(token, conn.externalId, imageUrl, {
            caption: captionFits ? picked.text : undefined,
          })
        : sendMessage(token, conn.externalId, picked.text, { disableWebPagePreview: false }),
    );
    if (imageUrl && !captionFits) {
      await withRetry(() =>
        sendMessage(token, conn.externalId, picked.text, { disableWebPagePreview: false }),
      );
    }
    const url = buildPostUrl(res.chat, res.message_id);
    await unwrap(
      supabaseAdmin.from("Post").insert({
        projectId,
        draftId,
        platform: "TELEGRAM",
        language: picked.lang,
        content: picked.text,
        imageUrl,
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
  imageUrl: string | null,
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
    // Upload the image under its own retry so a transient post failure doesn't
    // re-upload it (which would orphan an image asset on LinkedIn each retry).
    const imageUrn = imageUrl
      ? await withRetry(() => uploadLinkedInImage(token, conn.externalId, imageUrl))
      : null;
    const res = await withRetry(() =>
      createLinkedInPost(token, conn.externalId, picked.text, imageUrn),
    );
    await unwrap(
      supabaseAdmin.from("Post").insert({
        projectId,
        draftId,
        platform: "LINKEDIN",
        language: picked.lang,
        content: picked.text,
        imageUrl,
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
  // On a retry we skip platforms that already published successfully, so we
  // don't double-post to them while re-attempting the ones that errored.
  opts?: { skipPlatforms?: Platform[] },
): Promise<
  | { ok: true; posts: Array<{ platform: string; language: string; url: string | null }> }
  | { ok: false; error: string }
> {
  const { data: draft } = await selectDraftWithProject(supabaseAdmin, draftId);
  if (!draft) return { ok: false, error: "Draft not found." };
  if (draft.status === "PUBLISHED") return { ok: false, error: "Already published." };
  const skip = opts?.skipPlatforms ?? [];

  const content = draft.contentByLang as DraftContent;
  const contentByPlatform =
    (draft.contentByPlatform as DraftContentByPlatform | null) ?? null;
  const imageUrl = draft.imageUrl ?? null;

  const settings = draft.project.settings;
  const bannedWords = settings?.bannedWords ?? [];
  // Skip the edge round-trip entirely when there's nothing to moderate.
  if (settings && (bannedWords.length > 0 || settings.moderationEnabled)) {
    const allTexts = [
      ...Object.values(content),
      ...Object.values(contentByPlatform ?? {}).flatMap((v) => Object.values(v ?? {})),
    ];
    // Moderation (banned-word + optional AI check) runs in the edge function,
    // using this project's own Claude credential for the AI pass.
    const mod = await invokeEdge<
      { allowed: true } | { allowed: false; reason: string }
    >("moderate", {
      projectId: draft.projectId,
      texts: allTexts,
      bannedWords,
      moderationEnabled: settings.moderationEnabled,
    });
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
    if (skip.includes(platform)) continue;
    const conns = draft.project.connectedAccounts.filter((c) => c.platform === platform);
    for (const conn of conns) {
      const pub =
        platform === "TELEGRAM"
          ? await publishToTelegram(draft.projectId, draft.id, conn, content, contentByPlatform, imageUrl)
          : platform === "LINKEDIN"
          ? await publishToLinkedIn(draft.projectId, draft.id, conn, content, contentByPlatform, imageUrl)
          : null;
      if (pub) posts.push(pub);
    }
  }

  // Derive the final status from ALL post rows (including ones from earlier
  // attempts), not just the ones created in this pass. A draft counts as
  // PUBLISHED only when something shipped and nothing is left erroring — a
  // partial failure (e.g. Telegram ok, LinkedIn errored) stays FAILED so it
  // surfaces in the Failed filter and stays retryable.
  const allPosts = await unwrap(
    supabaseAdmin.from("Post").select("error").eq("draftId", draft.id),
  );
  const anyError = allPosts.some((p) => p.error);
  const anySuccess = allPosts.some((p) => !p.error);
  await unwrap(
    supabaseAdmin
      .from("Draft")
      .update({ status: anySuccess && !anyError ? "PUBLISHED" : "FAILED" })
      .eq("id", draft.id),
  );

  if (posts.length === 0) return { ok: false, error: "No posts were published. Check connections." };
  return { ok: true, posts };
}
