import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { generatePost, type VoiceCfg } from "@/lib/claude";
import { pickFreshArticle } from "@/lib/news";
import { publishDraft } from "@/server/publish";
import { computeScheduleInfo } from "@/lib/schedule";
import type { Platform, ProjectSettings } from "@prisma/client";

export type PipelineResult =
  | { ok: true; draftId: string; published: boolean; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

function unifiedVoice(s: ProjectSettings): VoiceCfg {
  return {
    writingStyle: s.writingStyle,
    customStyle: s.customStyle,
    includeHashtags: s.includeHashtags,
    includeSource: s.includeSource,
    maxPostChars: s.maxPostChars,
  };
}

function perPlatformVoice(
  s: ProjectSettings,
  targets: Platform[],
): Partial<Record<Platform, VoiceCfg>> {
  const fallback = unifiedVoice(s);
  const overrides = (s.voiceOverrides as Partial<Record<Platform, Partial<VoiceCfg>>>) ?? {};
  const out: Partial<Record<Platform, VoiceCfg>> = {};
  for (const t of targets) {
    const o = overrides[t] ?? {};
    out[t] = {
      writingStyle: o.writingStyle ?? fallback.writingStyle,
      customStyle: o.customStyle ?? fallback.customStyle,
      includeHashtags: o.includeHashtags ?? fallback.includeHashtags,
      includeSource: o.includeSource ?? fallback.includeSource,
      maxPostChars: o.maxPostChars ?? fallback.maxPostChars,
    };
  }
  return out;
}

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

  const isPerPlatform = settings.voiceMode === "PER_PLATFORM";
  const result = await generatePost({
    article,
    topics: settings.topics,
    languages: settings.languages,
    targets,
    voiceMode: isPerPlatform ? "PER_PLATFORM" : "UNIFIED",
    voice: isPerPlatform ? perPlatformVoice(settings, targets) : unifiedVoice(settings),
  });

  if (result.posts.length === 0) return { ok: false, error: "Model returned no posts." };

  // Build storage shape
  const contentByLang: Record<string, string> = {};
  const contentByPlatform: Record<string, Record<string, string>> = {};

  if (isPerPlatform) {
    for (const p of result.posts) {
      if (!p.platform) continue;
      contentByPlatform[p.platform] ??= {};
      contentByPlatform[p.platform][p.language] = p.content;
    }
    // Also fill contentByLang from the first platform we got, for fallback consumers.
    const firstPlatform = Object.keys(contentByPlatform)[0];
    if (firstPlatform) {
      for (const [lang, text] of Object.entries(contentByPlatform[firstPlatform])) {
        contentByLang[lang] = text;
      }
    }
  } else {
    for (const p of result.posts) contentByLang[p.language] = p.content;
  }

  const draft = await db.draft.create({
    data: {
      projectId: project.id,
      topic: settings.topics[0],
      sourceUrl: article.url,
      sourceTitle: article.title,
      contentByLang,
      contentByPlatform: isPerPlatform
        ? (contentByPlatform as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      targets,
      status: "PENDING",
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      costUsd: result.costUsd,
      confidence: result.confidence,
    },
  });

  // Mode routing
  const shouldAutoPublish =
    settings.mode === "AUTOPILOT" ||
    (settings.mode === "HYBRID" && result.confidence >= settings.confidenceThreshold);

  if (shouldAutoPublish) {
    const res = await publishDraft(draft.id);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, draftId: draft.id, published: true };
  }

  return { ok: true, draftId: draft.id, published: false };
}

export async function publishDueScheduledDrafts(): Promise<{
  published: number;
  errors: number;
}> {
  const due = await db.draft.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: new Date() },
    },
    select: { id: true },
  });
  let published = 0;
  let errors = 0;
  for (const d of due) {
    const res = await publishDraft(d.id);
    if (res.ok) published += 1;
    else errors += 1;
  }
  return { published, errors };
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
