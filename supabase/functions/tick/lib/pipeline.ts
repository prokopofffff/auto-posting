// The recurring content pipeline, ported from src/server/pipeline.ts. Picks a
// fresh fact-checked article, generates per-platform/unified copy with Claude,
// persists a Draft, and auto-publishes when mode + confidence + verification all
// clear. Logic is unchanged; only import paths differ.
import {
  selectProjectWithRelations,
  supabaseAdmin,
  unwrap,
} from "./supabase.ts";
import { generatePost, type GeneratedItem, type GenerateInput, type VoiceCfg } from "./claude.ts";
import { resolveModel } from "./ai-credentials.ts";
import { pickFreshArticle } from "./news.ts";
import { generateImage } from "./image-gen.ts";
import { publishDraft } from "./publish.ts";
import { computeScheduleInfo } from "./schedule.ts";
import { domainOf } from "./source-trust.ts";
import type { ProjectWithRelations } from "./supabase.ts";
import type { FactCheck, NewsItem } from "./news-types.ts";
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

// The platforms a project can currently publish to: Telegram if connected,
// LinkedIn if connected with a non-expired token. Shared by generation and
// regeneration so both target the same set.
function resolveTargets(project: ProjectWithRelations): Platform[] {
  const targets: Platform[] = [];
  if (project.connectedAccounts.some((c) => c.platform === "TELEGRAM")) targets.push("TELEGRAM");
  if (
    project.connectedAccounts.some(
      // expiresAt is an ISO string from supabase-js; parse before comparing.
      (c) => c.platform === "LINKEDIN" && (!c.expiresAt || new Date(c.expiresAt).getTime() > Date.now()),
    )
  )
    targets.push("LINKEDIN");
  return targets;
}

// Fold the model's per-post output into the Draft storage shape:
//   contentByLang     — { lang: text } (always set; used by single-voice publish)
//   contentByPlatform — { platform: { lang: text } } (per-platform mode only)
function buildContentShape(
  posts: GeneratedItem[],
  isPerPlatform: boolean,
): { contentByLang: Record<string, string>; contentByPlatform: Record<string, Record<string, string>> | null } {
  const contentByLang: Record<string, string> = {};
  if (!isPerPlatform) {
    for (const p of posts) contentByLang[p.language] = p.content;
    return { contentByLang, contentByPlatform: null };
  }
  const contentByPlatform: Record<string, Record<string, string>> = {};
  for (const p of posts) {
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
  return { contentByLang, contentByPlatform };
}

// Assemble the model inputs from a project's voice/language/audience settings.
// Shared by generation and regeneration so the two stay in lockstep — only the
// article, its fact-check, targets, and topic set legitimately differ.
function buildGenerateInput(
  settings: ProjectSettings,
  opts: { article: NewsItem; topics: string[]; targets: Platform[]; factCheck?: FactCheck },
): GenerateInput {
  const isPerPlatform = settings.voiceMode === "PER_PLATFORM";
  return {
    article: opts.article,
    topics: opts.topics,
    languages: settings.languages ?? ["en"],
    targets: opts.targets,
    voiceMode: isPerPlatform ? "PER_PLATFORM" : "UNIFIED",
    voice: isPerPlatform ? perPlatformVoice(settings, opts.targets) : unifiedVoice(settings),
    factCheck: opts.factCheck,
    audience: settings.audience,
    angle: settings.angle,
  };
}

export async function runPipelineForProject(
  projectId: string,
  // Manual topic override: when the user triggers "Generate now" for specific
  // topics, only these are used to pick an article (intersected with the
  // project's configured topics for safety). Omitted/empty → use all configured
  // topics, the normal scheduled behavior.
  topicsOverride?: string[],
): Promise<PipelineResult> {
  const { data: project } = await selectProjectWithRelations(
    supabaseAdmin,
    projectId,
  );
  if (!project) return { ok: false, error: "Project not found." };
  if (project.status !== "ACTIVE") return { ok: true, skipped: true, reason: "Project is paused." };

  const settings = project.settings;
  if (!settings) return { ok: false, error: "Project has no settings." };
  const configured = settings.topics ?? [];
  if (configured.length === 0) return { ok: true, skipped: true, reason: "No topics configured." };

  // Manual selection narrows to the chosen topics; an empty/absent override
  // falls back to everything configured. We intersect rather than trust the
  // caller blindly so a stale UI selection can't inject an unconfigured topic.
  const requested = (topicsOverride ?? []).map((t) => t.trim()).filter(Boolean);
  const topics = requested.length > 0
    ? configured.filter((t) => requested.includes(t))
    : configured;
  if (topics.length === 0) {
    return { ok: true, skipped: true, reason: "None of the selected topics are configured." };
  }

  const targets = resolveTargets(project);
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
  const result = await generatePost(
    buildGenerateInput(settings, { article, topics, targets, factCheck: article.factCheck }),
    resolved,
  );

  if (result.posts.length === 0) return { ok: false, error: "Model returned no posts." };

  // Best-effort AI-generated image, built from the model's visual prompt for the
  // post (falling back to the matched topic). Each generation is unique, so no
  // dedup is needed; we warm it now so an auto-published post ships a ready
  // image. null when IMAGE_GEN=off or no prompt, leaving the draft text-only.
  const imageQuery = result.imageQuery || article.matchedTopic || topics[0] || "";
  const imageUrl = await generateImage(imageQuery, { warm: true });

  // Build storage shape
  const { contentByLang, contentByPlatform } = buildContentShape(result.posts, isPerPlatform);

  const draft = await unwrap(
    supabaseAdmin
      .from("Draft")
      .insert({
        projectId: project.id,
        // The relevance gate sets matchedTopic to a configured topic (or null);
        // fall back to the first topic when it couldn't pin one down.
        topic: article.matchedTopic ?? topics[0],
        // Full intersection set the story sits at. Falls back to the single
        // matched topic, then the first selected topic, so the column is never
        // empty for a generated draft.
        topics:
          article.matchedTopics && article.matchedTopics.length > 0
            ? article.matchedTopics
            : article.matchedTopic
            ? [article.matchedTopic]
            : [topics[0]],
        sourceUrl: article.url,
        sourceTitle: article.title,
        // Persist the excerpt the model saw so "regenerate" can re-run against
        // the same story faithfully, not from the headline alone.
        sourceExcerpt: article.summary || null,
        imageUrl,
        // Persist the model's image prompt so "regenerate image" can build from
        // the same on-subject prompt the auto-pick used, not just the topic.
        imageQuery: result.imageQuery,
        contentByLang,
        // JSON columns take plain objects/null directly.
        contentByPlatform,
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

export type RegenerateResult =
  | { ok: true; draftId: string }
  | { ok: false; error: string };

// Rewrite an existing draft's copy against the SAME source story. Reuses the
// article fields persisted on the draft (title/url/excerpt + fact-check) so the
// new text is grounded the same way the original was — only the wording changes.
// The image, source, and targets are left untouched; status resets to PENDING so
// the fresh copy goes back through review.
export async function regenerateDraft(
  projectId: string,
  draftId: string,
): Promise<RegenerateResult> {
  // Both reads only need the ids that are already in scope, so fetch them
  // together. We select just the source/state columns we regenerate from —
  // pulling the old content blobs we're about to overwrite would be wasted I/O.
  const [{ data: draft }, { data: project }] = await Promise.all([
    supabaseAdmin
      .from("Draft")
      .select(
        "status, targets, topic, topics, sourceTitle, sourceUrl, sourceExcerpt, sourceTrust, factVerdict, corroboratingSources",
      )
      .eq("id", draftId)
      .eq("projectId", projectId)
      .maybeSingle(),
    selectProjectWithRelations(supabaseAdmin, projectId),
  ]);
  if (!draft) return { ok: false, error: "Draft not found." };
  if (draft.status === "PUBLISHED") {
    return { ok: false, error: "This draft is already published." };
  }
  if (!project?.settings) return { ok: false, error: "Project has no settings." };
  const settings = project.settings;

  // Regenerate for whatever the draft already targets; fall back to the
  // currently-connected platforms if the stored set is empty.
  const targets = (draft.targets && draft.targets.length > 0
    ? draft.targets
    : resolveTargets(project)) as Platform[];
  if (targets.length === 0) return { ok: false, error: "No connected accounts." };

  let resolved;
  try {
    resolved = await resolveModel(projectId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Reconstruct the model inputs from the persisted draft. sourceExcerpt may be
  // null for drafts created before it was stored — generatePost then writes from
  // the title alone.
  const article: NewsItem = {
    title: draft.sourceTitle ?? draft.topic,
    url: draft.sourceUrl ?? "",
    summary: draft.sourceExcerpt ?? "",
    source: domainOf(draft.sourceUrl) ?? "",
    publishedAt: null,
  };
  const factCheck: FactCheck = {
    trust: draft.sourceTrust ?? 0,
    verdict: draft.factVerdict ?? "UNVERIFIED",
    corroboratingSources: draft.corroboratingSources ?? [],
  };
  const topics = settings.topics ?? draft.topics ?? [];

  const isPerPlatform = settings.voiceMode === "PER_PLATFORM";
  let result;
  try {
    result = await generatePost(
      buildGenerateInput(settings, { article, topics, targets, factCheck }),
      resolved,
    );
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (result.posts.length === 0) return { ok: false, error: "Model returned no posts." };

  const { contentByLang, contentByPlatform } = buildContentShape(result.posts, isPerPlatform);

  await unwrap(
    supabaseAdmin
      .from("Draft")
      .update({
        contentByLang,
        contentByPlatform,
        confidence: result.confidence,
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        costUsd: result.costUsd,
        // Refresh the image query to track the rewritten copy so a later
        // re-pick stays on-subject. Only when the model returned one — don't
        // wipe a good query if it omitted it. The image itself is left as-is.
        ...(result.imageQuery ? { imageQuery: result.imageQuery } : {}),
        // Back to review: a regenerated draft shouldn't keep an APPROVED/SKIPPED
        // status that no longer reflects the new copy.
        status: "PENDING",
      })
      .eq("id", draftId),
  );

  return { ok: true, draftId };
}

export type PickPhotoResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

// Re-generate the image for an existing draft, built from the model's visual
// prompt (or the topic, for older/manually-composed drafts). A fresh random
// seed makes the result a *different* image every time, so `_exclude` (the
// editor's staged/current pick) is no longer needed. Returns the URL only;
// persisting it is the caller's job, so the editor can stage it and save on the
// user's confirmation. url is null when IMAGE_GEN=off or there's no prompt.
export async function pickDraftPhoto(
  projectId: string,
  draftId: string,
  _exclude: string[] = [],
): Promise<PickPhotoResult> {
  const { data: draft } = await supabaseAdmin
    .from("Draft")
    .select("topic, topics, imageQuery")
    .eq("id", draftId)
    .eq("projectId", projectId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Draft not found." };
  // Prefer the model's image prompt (set at generation) for an on-subject
  // image; fall back to the topic for older/manually-composed drafts.
  const query = draft.imageQuery || draft.topic || draft.topics?.[0] || "";
  if (!query) return { ok: false, error: "Draft has no topic to generate from." };

  // No warm: the editor preview <img> renders the URL and warms the CDN cache.
  const url = await generateImage(query);
  return { ok: true, url };
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
