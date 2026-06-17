import type { FactCheck, NewsItem } from "./news-types.ts";
import type { ResolvedModel } from "./ai-credentials.ts";

// Pricing is telemetry only (the cost estimate stored on the draft) and is
// independent of which credential is used — override per-MTok via env if your
// contract differs. Defaults approximate a mid-tier model.
const DEFAULT_INPUT_USD_PER_MTOK = 5;
const DEFAULT_OUTPUT_USD_PER_MTOK = 25;

function pricingPerMTok(): { input: number; output: number } {
  const input = Number(
    Deno.env.get("CLAUDE_INPUT_USD_PER_MTOK") ?? DEFAULT_INPUT_USD_PER_MTOK,
  );
  const output = Number(
    Deno.env.get("CLAUDE_OUTPUT_USD_PER_MTOK") ?? DEFAULT_OUTPUT_USD_PER_MTOK,
  );
  return { input, output };
}

function computeCostUsd(tokensInput: number, tokensOutput: number): number {
  const p = pricingPerMTok();
  return (
    (tokensInput / 1_000_000) * p.input + (tokensOutput / 1_000_000) * p.output
  );
}

// The model client now comes from the per-project credential resolver
// (./ai-credentials.ts), passed in by callers — no env-based singleton, and
// provider-agnostic (Claude or DeepSeek) via its `complete` closure.

const STYLE_DIRECTIVES: Record<string, string> = {
  professional:
    "Voice: polished, credible, industry-insider. Use precise language. No fluff. Occasional dry wit is allowed.",
  casual:
    "Voice: friendly, conversational, direct. Use contractions. Speak like a person, not a press release.",
  technical:
    "Voice: deep-dive, respectful of technical readers. Include concrete details, numbers, and mechanisms. No hand-waving.",
  provocative:
    "Voice: sharp opinion, hot-take, contrarian where warranted. Lead with a bold claim. Back it up briefly.",
  custom: "",
};

const LANG_LABEL: Record<string, string> = { en: "English", ru: "Russian" };

export type VoiceCfg = {
  writingStyle: string;
  customStyle?: string | null;
  includeHashtags: boolean;
  includeSource: boolean;
  maxPostChars: number;
};

export type Platform = "LINKEDIN" | "TELEGRAM";

export type GenerateInput = {
  article: NewsItem;
  topics: string[];
  languages: string[];
  targets: Platform[];
  /** Unified: one voice for all platforms. Per-platform: voice per Platform key. */
  voiceMode: "UNIFIED" | "PER_PLATFORM";
  voice: VoiceCfg | Partial<Record<Platform, VoiceCfg>>;
  /** Fact-check of the source article — drives hedging and confidence ceiling. */
  factCheck?: FactCheck;
  /** Who the post is for (e.g. "software developers building fintech"). */
  audience?: string | null;
  /** The lens to frame stories through (e.g. "engineering & infra implications"). */
  angle?: string | null;
};

/** Highest confidence we let an unverified story claim — forces human review. */
const UNVERIFIED_CONFIDENCE_CEILING = 45;

function verificationBlock(fc: FactCheck): string {
  if (fc.verdict === "TRUSTED") {
    return [
      "## Source verification",
      "The source is editorially trusted. Write normally and state facts directly.",
    ].join("\n");
  }
  if (fc.verdict === "CORROBORATED") {
    const witnesses = fc.corroboratingSources.join(", ");
    return [
      "## Source verification",
      `The origin source is not highly trusted, but the story is independently reported by: ${witnesses}.`,
      "You may state the facts, but attribute claims to reporting (e.g. \"according to reports\") rather than asserting them as confirmed.",
    ].join("\n");
  }
  return [
    "## Source verification",
    "WARNING: This story comes from a low-trust source and could NOT be independently corroborated.",
    "- Frame it cautiously as an unconfirmed report (\"reportedly\", \"a report claims\").",
    "- Do NOT present any claim as established fact.",
    `- Cap every post's "confidence" at ${UNVERIFIED_CONFIDENCE_CEILING} so a human reviews it before publishing.`,
  ].join("\n");
}

export type GeneratedItem = {
  platform?: Platform;
  language: string;
  content: string;
};

export type GenerationResult = {
  posts: GeneratedItem[];
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  confidence: number;
};

function voiceBlock(v: VoiceCfg, header: string): string {
  const styleBody =
    v.writingStyle === "custom"
      ? `Voice: custom. Follow these instructions exactly:\n${v.customStyle ?? ""}`
      : STYLE_DIRECTIVES[v.writingStyle] ?? STYLE_DIRECTIVES.professional;
  return [
    `### ${header}`,
    styleBody,
    `- Max ${v.maxPostChars} characters.`,
    v.includeHashtags
      ? "- End with 3-5 relevant hashtags on a new line, lowercase."
      : "- Do NOT include hashtags.",
    v.includeSource
      ? "- On a separate final line, include the source URL exactly as provided."
      : "- Do NOT include the source URL.",
  ].join("\n");
}

/**
 * The lines naming who a post is for and the lens to frame it through. Shared by
 * the generation prompt and the relevance scorer so the audience is described
 * identically in both. Returns [] when neither field is set.
 */
function audienceAngleLines(
  audience?: string | null,
  angle?: string | null,
): string[] {
  const a = audience?.trim();
  const g = angle?.trim();
  const out: string[] = [];
  if (a) out.push(`Write for: ${a}.`);
  if (g) out.push(`Frame every story through this lens: ${g}.`);
  return out;
}

function buildSystemPrompt(input: Omit<GenerateInput, "article">): string {
  const langLabels = input.languages.map((l) => LANG_LABEL[l] ?? l).join(", ");

  const lines: string[] = [
    "You are a social-media ghostwriter for a personal brand.",
    "You write short, engaging posts for LinkedIn and Telegram based on news articles.",
    "",
    "## Rules",
    "- Lead with a hook in the first line. No generic openers.",
    "- Show a point of view. Summarize what happened, then say why it matters.",
    "- Write in plain text only. No markdown headers, no asterisks for bold.",
    "",
    "## Topics of interest",
    input.topics.join(", "),
    "",
  ];

  const audienceLines = audienceAngleLines(input.audience, input.angle);
  if (audienceLines.length > 0) {
    lines.push(
      "## Audience & angle",
      ...audienceLines,
      "Choose what to emphasize, what to skip, and which implications to draw based on THIS audience.",
      "If the article has no genuine relevance or insight for this audience, do NOT force a post: set its confidence to 25 or below so a human reviews it instead of publishing.",
      "",
    );
  }

  if (input.voiceMode === "UNIFIED") {
    const v = input.voice as VoiceCfg;
    lines.push("## Voice", voiceBlock(v, "applies to all platforms"));
    lines.push(
      "",
      "## Output format",
      "Return STRICT JSON only, no prose:",
      '{ "posts": [ { "language": "en", "content": "...", "confidence": 90 }, ... ], "confidence": 90 }',
      "",
      `Produce ONE post per language (${langLabels}). The same text is sent to all selected platforms.`,
      "",
      'Each post object MUST include a "confidence" integer 0-100 reflecting your confidence the post is ready to publish unchanged. Use 0-49 for "needs human review", 50-79 for "fine but iffy", 80-100 for "ship it".',
    );
  } else {
    const per = input.voice as Partial<Record<Platform, VoiceCfg>>;
    lines.push("## Voice (per platform)");
    for (const t of input.targets) {
      const v = per[t];
      if (!v) continue;
      lines.push(voiceBlock(v, t.toLowerCase()));
      lines.push("");
    }
    lines.push(
      "## Output format",
      "Return STRICT JSON only, no prose:",
      '{ "posts": [ { "platform": "LINKEDIN", "language": "en", "content": "...", "confidence": 90 }, ... ] }',
      "",
      `Produce ONE post per (platform, language) combination. Platforms: ${input.targets.join(", ")}. Languages: ${langLabels}. Each variant must honor its platform's voice block above.`,
      "",
      'Each post object MUST include a "confidence" integer 0-100 reflecting your confidence the post is ready to publish unchanged.',
    );
  }
  return lines.join("\n");
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model response.");
  return JSON.parse(match[0]);
}

// The per-provider wire format (Anthropic prompt-cache blocks + oauth preamble,
// or DeepSeek's OpenAI-shaped call) lives in the resolver's `complete` closure,
// so callers below just hand it a system + user string and read back text +
// token counts.

export async function generatePost(
  input: GenerateInput,
  resolved: ResolvedModel,
): Promise<GenerationResult> {
  const { article, ...rest } = input;
  const system = buildSystemPrompt(rest);
  const userMsg = [
    `Article title: ${article.title}`,
    `Source: ${article.source}`,
    `URL: ${article.url}`,
    article.publishedAt ? `Published: ${article.publishedAt.toISOString()}` : "",
    "",
    "Article summary / excerpt:",
    article.summary || "(no excerpt available — write from the title alone)",
    input.factCheck ? `\n${verificationBlock(input.factCheck)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { text, tokensInput, tokensOutput } = await resolved.complete({
    system,
    user: userMsg,
    maxTokens: input.voiceMode === "PER_PLATFORM" ? 4000 : 2000,
  });

  const parsed = extractJson(text) as {
    posts?: Array<{
      platform?: string;
      language: string;
      content: string;
      confidence?: number;
    }>;
    confidence?: number;
  };
  if (!parsed.posts || !Array.isArray(parsed.posts)) {
    throw new Error("Model response missing 'posts' array.");
  }
  const cleaned = parsed.posts
    .filter((p) => p.language && p.content)
    .map((p) => ({
      platform:
        p.platform === "LINKEDIN" || p.platform === "TELEGRAM"
          ? (p.platform as Platform)
          : undefined,
      language: p.language,
      content: p.content.trim(),
      confidence: typeof p.confidence === "number" ? p.confidence : null,
    }));
  if (cleaned.length === 0) throw new Error("Model returned no usable posts.");

  const confidences = cleaned
    .map((p) => p.confidence)
    .filter((c): c is number => typeof c === "number");
  let confidence =
    confidences.length > 0
      ? Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length)
      : typeof parsed.confidence === "number"
      ? Math.round(parsed.confidence)
      : 90;

  // Hard ceiling for unverified stories, regardless of the model's optimism.
  if (input.factCheck?.verdict === "UNVERIFIED") {
    confidence = Math.min(confidence, UNVERIFIED_CONFIDENCE_CEILING);
  }

  return {
    posts: cleaned.map((p) => ({
      platform: p.platform,
      language: p.language,
      content: p.content,
    })),
    tokensInput,
    tokensOutput,
    costUsd: computeCostUsd(tokensInput, tokensOutput),
    confidence,
  };
}

// --- relevance gate --------------------------------------------------------
// Before generation, the pipeline asks the model to rank fresh candidates for
// how well they fit the creator's topics + audience + angle. This is what stops
// "newest article from a broad keyword search" (e.g. a bank merger matched by
// the word "fintech") from being posted just because it was recent.

export type RelevanceScore = {
  /** Index into the candidates array passed in. */
  index: number;
  /** 0-100; higher = more relevant and post-worthy for this creator. */
  score: number;
  /** Which configured topic it best matches (verbatim from `topics`), or null. */
  topic: string | null;
};

export type RelevanceInput = {
  topics: string[];
  audience?: string | null;
  angle?: string | null;
  candidates: Pick<NewsItem, "title" | "summary" | "source">[];
};

/**
 * Score candidate articles 0-100 for fit with the creator's interests. Returns
 * one entry per candidate (best-effort; missing entries are treated as 0 by the
 * caller). THROWS on a model/parse failure so the caller can fall back to its
 * recency ordering rather than silently dropping every candidate.
 */
export async function scoreCandidates(
  input: RelevanceInput,
  resolved: ResolvedModel,
): Promise<RelevanceScore[]> {
  if (input.candidates.length === 0) return [];

  const system = [
    "You are a news editor choosing which stories a specific creator should post about.",
    "Score each candidate article 0-100 for how relevant and post-worthy it is for THIS creator.",
    "",
    "## The creator",
    `Topics of interest: ${input.topics.join(", ")}.`,
    ...audienceAngleLines(input.audience, input.angle),
    "",
    "## Scoring rules",
    "- 80-100: squarely on-topic AND genuinely interesting for this audience.",
    "- 40-79: related but tangential, or on-topic but low insight.",
    "- 0-39: off-topic. A story that merely CONTAINS a topic keyword but is really about something else (e.g. a local bank merger when the topic is 'fintech', or an earnings report when the topic is 'ai') belongs here.",
    "- Reward stories that connect to MORE THAN ONE of the creator's topics.",
    "- Judge by what the story is actually ABOUT, not by keyword overlap.",
    "",
    "## Output format",
    "Return STRICT JSON only, no prose:",
    '{ "scores": [ { "index": 0, "score": 85, "topic": "ai" }, ... ] }',
    "Include one object per candidate. `topic` is the single best-matching topic from the list above, verbatim, or null if none fit.",
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = input.candidates
    .map((c, i) =>
      [
        `[${i}] ${c.title}`,
        c.source ? `source: ${c.source}` : "",
        c.summary ? `summary: ${c.summary.slice(0, 400)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  const { text } = await resolved.complete({
    system,
    user: userMsg,
    maxTokens: 800,
  });

  const parsed = extractJson(text) as {
    scores?: Array<{ index?: number; score?: number; topic?: string | null }>;
  };
  if (!parsed.scores || !Array.isArray(parsed.scores)) {
    throw new Error("Relevance response missing 'scores' array.");
  }
  return parsed.scores
    .filter(
      (s): s is { index: number; score: number; topic?: string | null } =>
        typeof s.index === "number" && typeof s.score === "number",
    )
    .map((s) => ({
      index: s.index,
      score: Math.max(0, Math.min(100, Math.round(s.score))),
      // Only trust a topic the model echoed back from the configured list —
      // anything else (a hallucinated or paraphrased topic) becomes null, so
      // callers can use it as a draft label without re-validating.
      topic:
        typeof s.topic === "string" && input.topics.includes(s.topic)
          ? s.topic
          : null,
    }));
}

export type AdHocInput = {
  topic: string;
  sourceUrl?: string | null;
  tone: keyof typeof STYLE_DIRECTIVES | string;
  customStyle?: string | null;
  language: string;
  includeHashtags: boolean;
  includeSource: boolean;
  maxChars: number;
};

export type AdHocResult = {
  content: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
};

export async function generateAdHocPost(
  input: AdHocInput,
  resolved: ResolvedModel,
): Promise<AdHocResult> {
  const styleBody =
    input.tone === "custom"
      ? `Voice: custom. Follow these instructions exactly:\n${input.customStyle ?? ""}`
      : STYLE_DIRECTIVES[input.tone] ?? STYLE_DIRECTIVES.professional;
  const langLabel = LANG_LABEL[input.language] ?? input.language;

  const system = [
    "You are a social-media ghostwriter for a personal brand.",
    "You write short, engaging posts for LinkedIn and Telegram.",
    "",
    "## Style",
    styleBody,
    "",
    "## Rules",
    `- Stay strictly under ${input.maxChars} characters.`,
    "- Write in plain text only. No markdown headers, no asterisks for bold.",
    "- Lead with a hook in the first line. No generic openers.",
    "- Show a point of view. Summarize what happened, then say why it matters.",
    input.includeHashtags
      ? "- End with 3-5 relevant hashtags on a new line, lowercase."
      : "- Do NOT include hashtags.",
    input.includeSource && input.sourceUrl
      ? "- On a separate final line, include the source URL exactly as provided."
      : "- Do NOT include any source URL.",
    "",
    `Write in ${langLabel}.`,
    "",
    "## Output format",
    "Return STRICT JSON only, no prose:",
    '{ "content": "..." }',
  ].join("\n");

  const userMsg = [
    `Topic / angle: ${input.topic}`,
    input.sourceUrl ? `Source URL: ${input.sourceUrl}` : "",
    "",
    "Write the post now.",
  ]
    .filter(Boolean)
    .join("\n");

  const { text, tokensInput, tokensOutput } = await resolved.complete({
    system,
    user: userMsg,
    maxTokens: 1500,
  });
  const parsed = extractJson(text) as { content?: string };
  if (!parsed.content) throw new Error("Model response missing 'content'.");
  return {
    content: parsed.content.trim(),
    tokensInput,
    tokensOutput,
    costUsd: computeCostUsd(tokensInput, tokensOutput),
  };
}
