import Anthropic from "@anthropic-ai/sdk";
import type { FactCheck, NewsItem } from "@/lib/news-types";

const MODEL = "claude-opus-4-7";

const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const CLAUDE_CODE_PREAMBLE =
  "You are Claude Code, Anthropic's official CLI for Claude.";

// Default pricing for claude-opus-4-7 — override via env if your contract differs.
const DEFAULT_INPUT_USD_PER_MTOK = 15;
const DEFAULT_OUTPUT_USD_PER_MTOK = 75;

function pricingPerMTok(): { input: number; output: number } {
  const input = Number(
    process.env.CLAUDE_INPUT_USD_PER_MTOK ?? DEFAULT_INPUT_USD_PER_MTOK,
  );
  const output = Number(
    process.env.CLAUDE_OUTPUT_USD_PER_MTOK ?? DEFAULT_OUTPUT_USD_PER_MTOK,
  );
  return { input, output };
}

function computeCostUsd(tokensInput: number, tokensOutput: number): number {
  const p = pricingPerMTok();
  return (
    (tokensInput / 1_000_000) * p.input + (tokensOutput / 1_000_000) * p.output
  );
}

type ClientMode = { client: Anthropic; oauth: boolean };

let _client: ClientMode | null = null;
function client(): ClientMode {
  if (!_client) {
    const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (oauthToken) {
      _client = {
        client: new Anthropic({
          authToken: oauthToken,
          apiKey: null,
          defaultHeaders: { "anthropic-beta": OAUTH_BETA_HEADER },
        }),
        oauth: true,
      };
    } else if (apiKey) {
      _client = { client: new Anthropic(), oauth: false };
    } else {
      throw new Error(
        "Set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`) or ANTHROPIC_API_KEY",
      );
    }
  }
  return _client;
}

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

async function callModel(
  systemText: string,
  userText: string,
  maxTokens: number,
) {
  const c = client();
  const systemBlocks: Anthropic.TextBlockParam[] = [];
  if (c.oauth) systemBlocks.push({ type: "text", text: CLAUDE_CODE_PREAMBLE });
  systemBlocks.push({
    type: "text",
    text: systemText,
    cache_control: { type: "ephemeral" },
  });
  const response = await c.client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system: systemBlocks,
    messages: [{ role: "user", content: userText }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const usage = response.usage;
  // Count every input bucket: fresh, cache reads, and cache *writes* (cache misses —
  // the common case here since pipeline runs are spaced well beyond the ephemeral TTL).
  const tokensInput =
    (usage?.input_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0) +
    (usage?.cache_creation_input_tokens ?? 0);
  const tokensOutput = usage?.output_tokens ?? 0;
  return { text, tokensInput, tokensOutput };
}

export async function generatePost(input: GenerateInput): Promise<GenerationResult> {
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

  const { text, tokensInput, tokensOutput } = await callModel(
    system,
    userMsg,
    input.voiceMode === "PER_PLATFORM" ? 4000 : 2000,
  );

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

export async function generateAdHocPost(input: AdHocInput): Promise<AdHocResult> {
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

  const { text, tokensInput, tokensOutput } = await callModel(system, userMsg, 1500);
  const parsed = extractJson(text) as { content?: string };
  if (!parsed.content) throw new Error("Model response missing 'content'.");
  return {
    content: parsed.content.trim(),
    tokensInput,
    tokensOutput,
    costUsd: computeCostUsd(tokensInput, tokensOutput),
  };
}
