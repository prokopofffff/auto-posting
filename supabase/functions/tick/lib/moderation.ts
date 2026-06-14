import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-7";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic();
  }
  return _client;
}

export type ModerationResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export type ModerationInput = {
  texts: string[]; // one per language
  bannedWords: string[];
  moderationEnabled: boolean;
};

function checkBannedWords(
  texts: string[],
  bannedWords: string[],
): ModerationResult {
  if (bannedWords.length === 0) return { allowed: true };
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const raw of bannedWords) {
      const word = raw.trim().toLowerCase();
      if (!word) continue;
      // whole-word match for simple tokens; substring for multi-word phrases
      if (/^\w+$/.test(word)) {
        const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(lower)) {
          return { allowed: false, reason: `Banned word detected: "${raw}"` };
        }
      } else if (lower.includes(word)) {
        return { allowed: false, reason: `Banned phrase detected: "${raw}"` };
      }
    }
  }
  return { allowed: true };
}

async function checkClaudeModeration(texts: string[]): Promise<ModerationResult> {
  const combined = texts
    .map((t, i) => `--- post ${i + 1} ---\n${t}`)
    .join("\n\n");

  const system = [
    "You are a content moderator for a social-media posting tool.",
    "You review proposed posts before they go live on LinkedIn or Telegram.",
    "Block content that is:",
    "- hate speech, harassment, or targeted slurs",
    "- explicit sexual content, gore, or shock material",
    "- direct incitement of violence",
    "- clearly illegal content (CSAM, direct solicitation of crime)",
    "- unambiguous defamation of a named private individual",
    "",
    "Do NOT block content just because it is:",
    "- opinionated, provocative, or critical of public figures / companies",
    "- about politics, religion, or other sensitive topics",
    "- in a language other than English",
    "",
    "Return STRICT JSON only: { \"blocked\": boolean, \"reason\": string | null }",
    "Reason should be one short sentence (max 120 chars) when blocked, else null.",
  ].join("\n");

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 200,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: combined }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { allowed: true };
  try {
    const parsed = JSON.parse(match[0]) as { blocked?: boolean; reason?: string };
    if (parsed.blocked) {
      return { allowed: false, reason: parsed.reason?.slice(0, 120) ?? "Flagged by AI moderation" };
    }
  } catch {
    // If model returns malformed JSON, fail-open (don't block posts due to moderator bug)
  }
  return { allowed: true };
}

export async function moderate(input: ModerationInput): Promise<ModerationResult> {
  const wordCheck = checkBannedWords(input.texts, input.bannedWords);
  if (!wordCheck.allowed) return wordCheck;
  if (input.moderationEnabled) {
    try {
      return await checkClaudeModeration(input.texts);
    } catch {
      // Moderation service error → fail-open; the user sees it in telemetry later
      return { allowed: true };
    }
  }
  return { allowed: true };
}
