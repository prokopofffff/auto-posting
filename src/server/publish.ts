import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { buildPostUrl, sendMessage } from "@/lib/telegram";
import { createPost as createLinkedInPost } from "@/lib/linkedin";
import { moderate } from "@/lib/moderation";
import type { ConnectedAccount } from "@prisma/client";

export type DraftContent = Record<string, string>; // lang -> text

function pickContent(content: DraftContent): { lang: string; text: string } | null {
  const en = content.en;
  if (en) return { lang: "en", text: en };
  const first = Object.entries(content)[0];
  if (!first) return null;
  return { lang: first[0], text: first[1] };
}

async function publishToTelegram(
  projectId: string,
  draftId: string,
  conn: ConnectedAccount,
  content: DraftContent,
) {
  if (!conn.accessToken) return null;
  const picked = pickContent(content);
  if (!picked) return null;
  const token = decrypt(conn.accessToken);
  try {
    const res = await sendMessage(token, conn.externalId, picked.text, {
      disableWebPagePreview: false,
    });
    const url = buildPostUrl(res.chat, res.message_id);
    await db.post.create({
      data: {
        projectId,
        draftId,
        platform: "TELEGRAM",
        language: picked.lang,
        content: picked.text,
        externalId: String(res.message_id),
        externalUrl: url,
      },
    });
    return { platform: "TELEGRAM" as const, language: picked.lang, url };
  } catch (e) {
    await db.post.create({
      data: {
        projectId,
        draftId,
        platform: "TELEGRAM",
        language: picked.lang,
        content: picked.text,
        error: (e as Error).message,
      },
    });
    return null;
  }
}

async function publishToLinkedIn(
  projectId: string,
  draftId: string,
  conn: ConnectedAccount,
  content: DraftContent,
) {
  if (!conn.accessToken) return null;
  if (conn.expiresAt && conn.expiresAt.getTime() < Date.now()) {
    await db.post.create({
      data: {
        projectId,
        draftId,
        platform: "LINKEDIN",
        language: "en",
        content: "",
        error: "LinkedIn token expired — reconnect the account in Settings.",
      },
    });
    return null;
  }
  const picked = pickContent(content);
  if (!picked) return null;
  const token = decrypt(conn.accessToken);
  try {
    const res = await createLinkedInPost(token, conn.externalId, picked.text);
    await db.post.create({
      data: {
        projectId,
        draftId,
        platform: "LINKEDIN",
        language: picked.lang,
        content: picked.text,
        externalId: res.id || null,
        externalUrl: res.url,
      },
    });
    return { platform: "LINKEDIN" as const, language: picked.lang, url: res.url };
  } catch (e) {
    await db.post.create({
      data: {
        projectId,
        draftId,
        platform: "LINKEDIN",
        language: picked.lang,
        content: picked.text,
        error: (e as Error).message,
      },
    });
    return null;
  }
}

export async function publishDraft(draftId: string): Promise<
  | { ok: true; posts: Array<{ platform: string; language: string; url: string | null }> }
  | { ok: false; error: string }
> {
  const draft = await db.draft.findUnique({
    where: { id: draftId },
    include: {
      project: { include: { connectedAccounts: true, settings: true } },
    },
  });
  if (!draft) return { ok: false, error: "Draft not found." };
  if (draft.status === "PUBLISHED") return { ok: false, error: "Already published." };

  const content = draft.contentByLang as DraftContent;

  const settings = draft.project.settings;
  if (settings) {
    const mod = await moderate({
      texts: Object.values(content),
      bannedWords: settings.bannedWords,
      moderationEnabled: settings.moderationEnabled,
    });
    if (!mod.allowed) {
      await db.post.create({
        data: {
          projectId: draft.projectId,
          draftId: draft.id,
          platform: draft.targets[0] ?? "TELEGRAM",
          language: Object.keys(content)[0] ?? "en",
          content: "",
          error: `Blocked by safety check: ${mod.reason}`,
        },
      });
      await db.draft.update({ where: { id: draft.id }, data: { status: "FAILED" } });
      return { ok: false, error: `Blocked by safety check: ${mod.reason}` };
    }
  }

  const posts: Array<{ platform: string; language: string; url: string | null }> = [];

  for (const platform of draft.targets) {
    const conns = draft.project.connectedAccounts.filter((c) => c.platform === platform);
    for (const conn of conns) {
      const pub =
        platform === "TELEGRAM"
          ? await publishToTelegram(draft.projectId, draft.id, conn, content)
          : platform === "LINKEDIN"
          ? await publishToLinkedIn(draft.projectId, draft.id, conn, content)
          : null;
      if (pub) posts.push(pub);
    }
  }

  await db.draft.update({
    where: { id: draft.id },
    data: { status: posts.length > 0 ? "PUBLISHED" : "FAILED" },
  });

  if (posts.length === 0) return { ok: false, error: "No posts were published. Check connections." };
  return { ok: true, posts };
}
