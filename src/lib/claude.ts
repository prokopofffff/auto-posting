import Anthropic from "@anthropic-ai/sdk";
import type { NewsItem } from "@/lib/news";

const MODEL = "claude-opus-4-7";

const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const CLAUDE_CODE_PREAMBLE =
  "You are Claude Code, Anthropic's official CLI for Claude.";

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

export type GenerateInput = {
  article: NewsItem;
  topics: string[];
  languages: string[];
  writingStyle: keyof typeof STYLE_DIRECTIVES | string;
  customStyle?: string | null;
  includeHashtags: boolean;
  includeSource: boolean;
  maxPostChars: number;
};

export type GeneratedPost = { language: string; content: string };

function buildSystemPrompt(input: Omit<GenerateInput, "article">): string {
  const styleBody =
    input.writingStyle === "custom"
      ? `Voice: custom. Follow these instructions exactly:\n${input.customStyle ?? ""}`
      : STYLE_DIRECTIVES[input.writingStyle] ?? STYLE_DIRECTIVES.professional;

  return [
    "You are a social-media ghostwriter for a personal brand.",
    "You write short, engaging posts for LinkedIn and Telegram based on news articles.",
    "",
    "## Style",
    styleBody,
    "",
    "## Rules",
    `- Stay strictly under ${input.maxPostChars} characters for EACH language.`,
    "- Lead with a hook in the first line. No generic openers (\"In today's fast-paced world...\").",
    "- Show a point of view. Summarize what happened, then say why it matters.",
    "- Write in plain text only. No markdown headers, no asterisks for bold.",
    input.includeHashtags
      ? "- End with 3-5 relevant hashtags on a new line, lowercase."
      : "- Do NOT include hashtags.",
    input.includeSource
      ? "- On a separate final line, include the source URL exactly as provided."
      : "- Do NOT include the source URL.",
    "",
    "## Topics of interest",
    input.topics.join(", "),
    "",
    "## Output format",
    "Return STRICT JSON only, no prose:",
    '{ "posts": [ { "language": "en", "content": "..." }, ... ] }',
    "",
    `Languages to produce: ${input.languages.map((l) => LANG_LABEL[l] ?? l).join(", ")}.`,
  ].join("\n");
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model response.");
  return JSON.parse(match[0]);
}

export async function generatePost(input: GenerateInput): Promise<GeneratedPost[]> {
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
  ]
    .filter(Boolean)
    .join("\n");

  const c = client();
  const systemBlocks: Anthropic.TextBlockParam[] = [];
  if (c.oauth) {
    systemBlocks.push({ type: "text", text: CLAUDE_CODE_PREAMBLE });
  }
  systemBlocks.push({
    type: "text",
    text: system,
    cache_control: { type: "ephemeral" },
  });

  const response = await c.client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    system: systemBlocks,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJson(text) as { posts?: Array<{ language: string; content: string }> };
  if (!parsed.posts || !Array.isArray(parsed.posts)) {
    throw new Error("Model response missing 'posts' array.");
  }
  return parsed.posts
    .filter((p) => p.language && p.content)
    .map((p) => ({ language: p.language, content: p.content.trim() }));
}
