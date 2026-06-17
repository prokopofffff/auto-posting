// The recurring content pipeline, ported from src/server/pipeline.ts. Picks a
// fresh fact-checked article, generates per-platform/unified copy with Claude,
// persists a Draft, and auto-publishes when mode + confidence + verification all
// clear. Logic is unchanged; only import paths differ.
import {
  selectProjectWithRelations,
  supabaseAdmin,
  unwrap,
} from "./supabase.ts";
import { generatePost, type VoiceCfg } from "./claude.ts";
import { resolveModel } from "./ai-credentials.ts";
import { pickFreshArticle } from "./news.ts";
import { publishDraft } from "./publish.ts";
import { computeScheduleInfo } from "./schedule.ts";
import type { Platform, ProjectSettings } from "./types.ts";

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
  const { data: project } = await selectProjectWithRelations(
    supabaseAdmin,
    projectId,
  );
  if (!project) return { ok: false, error: "Project not found." };
  if (project.status !== "ACTIVE") return { ok: true, skipped: true, reason: "Project is paused." };

  const settings = project.settings;
  if (!settings) return { ok: false, error: "Project has no settings." };
  const topics = settings.topics ?? [];
  if (topics.length === 0) return { ok: true, skipped: true, reason: "No topics configured." };

  const targets: Platform[] = [];
  if (project.connectedAccounts.some((c) => c.platform === "TELEGRAM")) targets.push("TELEGRAM");
  if (
    project.connectedAccounts.some(
      // expiresAt is an ISO string from supabase-js; parse before comparing.
      (c) => c.platform === "LINKEDIN" && (!c.expiresAt || new Date(c.expiresAt).getTime() > Date.now()),
    )
  )
    targets.push("LINKEDIN");
  if (targets.length === 0) return { ok: true, skipped: true, reason: "No connected accounts." };

  // Resolve this project's own AI credential up front so a missing/expired
  // credential fails fast with a clear message — before we spend a news fetch.
  let resolved;
  try {
    resolved = await resolveModel(projectId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const article = await pickFreshArticle(projectId, topics, {
    resolved,
    audience: settings.audience,
    angle: settings.angle,
  });
  if (!article) {
    return {
      ok: true,
      skipped: true,
      reason: "No sufficiently relevant news found for the configured topics and audience.",
    };
  }

  const isPerPlatform = settings.voiceMode === "PER_PLATFORM";
  const result = await generatePost({
    article,
    topics,
    languages: settings.languages ?? ["en"],
    targets,
    voiceMode: isPerPlatform ? "PER_PLATFORM" : "UNIFIED",
    voice: isPerPlatform ? perPlatformVoice(settings, targets) : unifiedVoice(settings),
    factCheck: article.factCheck,
    audience: settings.audience,
    angle: settings.angle,
  }, resolved);

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

  const draft = await unwrap(
    supabaseAdmin
      .from("Draft")
      .insert({
        projectId: project.id,
        // The relevance gate sets matchedTopic to a configured topic (or null);
        // fall back to the first topic when it couldn't pin one down.
        topic: article.matchedTopic ?? topics[0],
        sourceUrl: article.url,
        sourceTitle: article.title,
        contentByLang,
        // JSON columns take plain objects/null directly.
        contentByPlatform: isPerPlatform ? contentByPlatform : null,
        targets,
        status: "PENDING",
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        costUsd: result.costUsd,
        confidence: result.confidence,
        factVerdict: article.factCheck.verdict,
        sourceTrust: article.factCheck.trust,
        corroboratingSources: article.factCheck.corroboratingSources,
      })
      .select()
      .single(),
  );

  // Mode routing. An unverified story (low-trust source, no corroboration)
  // never auto-publishes — it always waits for a human, regardless of mode.
  const verified = article.factCheck.verdict !== "UNVERIFIED";
  const shouldAutoPublish =
    verified &&
    (settings.mode === "AUTOPILOT" ||
      (settings.mode === "HYBRID" && result.confidence >= settings.confidenceThreshold));

  if (shouldAutoPublish) {
    // Reuse the client we already resolved for generation — no second lookup.
    const res = await publishDraft(draft.id, resolved);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, draftId: draft.id, published: true };
  }

  return { ok: true, draftId: draft.id, published: false };
}

export async function publishDueScheduledDrafts(): Promise<{
  published: number;
  errors: number;
}> {
  const due = await unwrap(
    supabaseAdmin
      .from("Draft")
      .select("id")
      .eq("status", "SCHEDULED")
      .lte("scheduledAt", new Date().toISOString()),
  );
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
  const projects = await unwrap(
    supabaseAdmin.from("Project").select("id").eq("status", "ACTIVE"),
  );

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
