import Anthropic from "npm:@anthropic-ai/sdk@0.90.0";
import {
  CLAUDE_CODE_PREAMBLE,
  resolveClaude,
  type ResolvedClaude,
} from "./ai-credentials.ts";

export type ModerationResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export type ModerationInput = {
  texts: string[]; // one per language
  bannedWords: string[];
  moderationEnabled: boolean;
  // AI moderation runs through the project's own Claude credential.
  projectId: string;
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

async function checkClaudeModeration(
  texts: string[],
  resolved: ResolvedClaude,
): Promise<ModerationResult> {
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

  const systemBlocks: Anthropic.TextBlockParam[] = [];
  if (resolved.oauth) systemBlocks.push({ type: "text", text: CLAUDE_CODE_PREAMBLE });
  systemBlocks.push({ type: "text", text: system, cache_control: { type: "ephemeral" } });

  const response = await resolved.client.messages.create({
    model: resolved.model,
    max_tokens: 200,
    system: systemBlocks,
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

export async function moderate(
  input: ModerationInput,
  // Reuse an already-resolved client (e.g. the autopublish path that just
  // generated with it) to avoid a second credential lookup + token refresh.
  resolved?: ResolvedClaude,
): Promise<ModerationResult> {
  const wordCheck = checkBannedWords(input.texts, input.bannedWords);
  if (!wordCheck.allowed) return wordCheck;
  if (input.moderationEnabled) {
    try {
      return await checkClaudeModeration(
        input.texts,
        resolved ?? (await resolveClaude(input.projectId)),
      );
    } catch {
      // No credential connected, or moderation service error → fail-open; the
      // user sees publish telemetry either way.
      return { allowed: true };
    }
  }
  return { allowed: true };
}
