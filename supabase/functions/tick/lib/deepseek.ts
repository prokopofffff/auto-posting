// DeepSeek provider — the OpenAI-compatible half of the model resolver.
//
// DeepSeek's API (api.deepseek.com) speaks the OpenAI Chat Completions wire
// format, NOT Anthropic's, so it can't reuse the @anthropic-ai/sdk client. The
// surface we need is tiny (one chat completion, one model list), so we call it
// over plain fetch rather than pull in a second SDK. The resolver wraps these
// in the same `complete` / `listModels` shape Anthropic uses, so the rest of
// the pipeline (claude.ts, moderation.ts) stays provider-agnostic.
import type { CompletionRequest, CompletionResult, ModelOption } from "./ai-credentials.ts";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

// Used only when a project picked DeepSeek but not yet a specific model.
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";

// DeepSeek model ids are stable and few; this is also the fallback list shown
// when the live /models call can't be reached.
export const DEEPSEEK_FALLBACK_MODELS: ModelOption[] = [
  { id: "deepseek-chat", displayName: "DeepSeek-V3 (deepseek-chat)" },
  { id: "deepseek-reasoner", displayName: "DeepSeek-R1 (deepseek-reasoner)" },
];

/** True for a stored model id that belongs to DeepSeek (used to guard against a leftover Claude id when the provider is DeepSeek, and vice-versa). */
export function isDeepSeekModel(model: string | null | undefined): boolean {
  return !!model && model.startsWith("deepseek");
}

/**
 * Build the provider-agnostic `complete` closure for a DeepSeek key + model.
 * Mirrors the Anthropic one in ai-credentials.ts: takes a single system + user
 * string and returns text plus token counts. No prompt caching / oauth preamble
 * — those are Anthropic-only concepts.
 */
export function deepseekComplete(apiKey: string, model: string) {
  return async ({ system, user, maxTokens }: CompletionRequest): Promise<CompletionResult> => {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
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
        `DeepSeek request failed (${res.status}). ${detail || "Check the API key in Settings → AI."}`,
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

/** Live DeepSeek model list (OpenAI-shaped /models). Falls back to the static list on any error. */
export async function deepseekListModels(
  apiKey: string,
): Promise<{ models: ModelOption[]; live: boolean }> {
  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { models: DEEPSEEK_FALLBACK_MODELS, live: false };
    const data = (await res.json()) as { data?: { id: string }[] };
    const models = (data.data ?? []).map((m) => ({ id: m.id, displayName: m.id }));
    if (models.length === 0) return { models: DEEPSEEK_FALLBACK_MODELS, live: false };
    return { models, live: true };
  } catch {
    return { models: DEEPSEEK_FALLBACK_MODELS, live: false };
  }
}
