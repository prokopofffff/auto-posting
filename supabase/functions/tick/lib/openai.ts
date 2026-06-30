// OpenAI provider — the second OpenAI-compatible half of the model resolver.
//
// Handles both OPENAI/API_KEY (platform.openai.com key) and OPENAI/SUBSCRIPTION
// (Codex OAuth token). Both reach the same api.openai.com endpoint; the only
// difference is auth header style (Bearer for both, but the token source differs).
//
// Uses plain fetch over the OpenAI Chat Completions wire format — the surface
// we need is tiny (one completion, one model list), so no SDK needed.
import type { CompletionRequest, CompletionResult, ModelOption } from "./ai-credentials.ts";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

export const OPENAI_FALLBACK_MODELS: ModelOption[] = [
  { id: "gpt-4o-mini", displayName: "GPT-4o mini" },
  { id: "gpt-4o", displayName: "GPT-4o" },
  { id: "o1", displayName: "o1" },
  { id: "o3-mini", displayName: "o3-mini" },
  { id: "o4-mini", displayName: "o4-mini" },
];

/** True for a stored model id that belongs to OpenAI. Used to guard against a leftover Claude/DeepSeek id when the provider is OPENAI. */
export function isOpenAiModel(model: string | null | undefined): boolean {
  if (!model) return false;
  return (
    model.startsWith("gpt-") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4") ||
    model.startsWith("text-")
  );
}

export function openaiComplete(apiKey: string, model: string) {
  return async ({ system, user, maxTokens }: CompletionRequest): Promise<CompletionResult> => {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(
        `OpenAI request failed (${res.status}). ${detail || "Check the API key in Settings → AI."}`,
      );
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage ?? {};
    return {
      text,
      tokensInput: usage.prompt_tokens ?? 0,
      tokensOutput: usage.completion_tokens ?? 0,
    };
  };
}

/** Live OpenAI model list. Falls back to the static list on any error. */
export async function openaiListModels(
  apiKey: string,
): Promise<{ models: ModelOption[]; live: boolean }> {
  try {
    const res = await fetch(`${OPENAI_BASE_URL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { models: OPENAI_FALLBACK_MODELS, live: false };
    const data = (await res.json()) as { data?: { id: string }[] };
    const all = (data.data ?? [])
      .map((m) => ({ id: m.id, displayName: m.id }))
      // Surface only chat-capable models; filter out embeddings/whisper/tts/dall-e.
      .filter((m) => isOpenAiModel(m.id));
    if (all.length === 0) return { models: OPENAI_FALLBACK_MODELS, live: false };
    return { models: all, live: true };
  } catch {
    return { models: OPENAI_FALLBACK_MODELS, live: false };
  }
}
