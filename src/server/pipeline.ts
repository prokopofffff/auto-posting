import { db } from "@/lib/db";
import { generatePost } from "@/lib/claude";
import { pickFreshArticle } from "@/lib/news";
import { publishDraft } from "@/server/publish";
import { computeScheduleInfo } from "@/lib/schedule";
import type { Platform } from "@prisma/client";

export type PipelineResult =
  | { ok: true; draftId: string; published: boolean; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export async function runPipelineForProject(projectId: string): Promise<PipelineResult> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { settings: true, connectedAccounts: true },
  });
  if (!project) return { ok: false, error: "Project not found." };
  if (project.status !== "ACTIVE") return { ok: true, skipped: true, reason: "Project is paused." };

  const settings = project.settings;
  if (!settings) return { ok: false, error: "Project has no settings." };
  if (settings.topics.length === 0) return { ok: true, skipped: true, reason: "No topics configured." };

  const targets: Platform[] = [];
  if (project.connectedAccounts.some((c) => c.platform === "TELEGRAM")) targets.push("TELEGRAM");
  if (
    project.connectedAccounts.some(
      (c) => c.platform === "LINKEDIN" && (!c.expiresAt || c.expiresAt.getTime() > Date.now()),
    )
  )
    targets.push("LINKEDIN");
  if (targets.length === 0) return { ok: true, skipped: true, reason: "No connected accounts." };

  const article = await pickFreshArticle(projectId, settings.topics);
  if (!article) return { ok: true, skipped: true, reason: "No fresh news found for configured topics." };

  const posts = await generatePost({
    article,
    topics: settings.topics,
    languages: settings.languages,
    writingStyle: settings.writingStyle,
    customStyle: settings.customStyle,
    includeHashtags: settings.includeHashtags,
    includeSource: settings.includeSource,
    maxPostChars: settings.maxPostChars,
  });

  if (posts.length === 0) return { ok: false, error: "Model returned no posts." };

  const contentByLang: Record<string, string> = {};
  for (const p of posts) contentByLang[p.language] = p.content;

  const draft = await db.draft.create({
    data: {
      projectId: project.id,
      topic: settings.topics[0],
      sourceUrl: article.url,
      sourceTitle: article.title,
      contentByLang,
      targets,
      status: "PENDING",
    },
  });

  if (settings.mode === "AUTOPILOT") {
    const res = await publishDraft(draft.id);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, draftId: draft.id, published: true };
  }

  return { ok: true, draftId: draft.id, published: false };
}

export async function runPipelineForAllDue(): Promise<{ ran: number; errors: number }> {
  const projects = await db.project.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  let ran = 0;
  let errors = 0;

  for (const proj of projects) {
    const info = await computeScheduleInfo(proj.id);
    if (!info?.dueNow) continue;
    const res = await runPipelineForProject(proj.id);
    if (res.ok) ran++;
    else errors++;
  }

  return { ran, errors };
}
