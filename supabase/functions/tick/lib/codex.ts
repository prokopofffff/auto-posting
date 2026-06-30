// Codex (ChatGPT subscription) provider — the OAuth half of the OpenAI path.
//
// A ChatGPT-subscription OAuth token does NOT work against api.openai.com. Codex
// routes its traffic through the ChatGPT backend instead:
//
//     POST https://chatgpt.com/backend-api/codex/responses     (Responses API wire format)
//     Authorization: Bearer <oauth access token>
//     ChatGPT-Account-Id: <chatgpt_account_id from the JWT>
//
// This is the same endpoint/headers the open-source Codex CLI uses. The Responses
// API differs from Chat Completions: input is a typed message array, the system
// prompt rides in `instructions`, `store` must be false, and the reply streams
// back as SSE events we reassemble into one string.
//
// Wrapped in the same `complete` / `listModels` shape Anthropic/DeepSeek use, so
// the rest of the pipeline stays provider-agnostic.
import type { CompletionRequest, CompletionResult, ModelOption } from "./ai-credentials.ts";

const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

// For ChatGPT-authenticated Codex, gpt-5.5 is the current default (gpt-5.4 the
// fallback). Used only when a project picked Codex but not a specific model.
export const CODEX_DEFAULT_MODEL = "gpt-5.5";

// Fallback/picker list — the ChatGPT backend has no public /models endpoint for
// subscription tokens, so we ship the known Codex-selectable models. New ones can
// still be typed/selected; this is just the menu.
export const CODEX_FALLBACK_MODELS: ModelOption[] = [
  { id: "gpt-5.5", displayName: "GPT-5.5" },
  { id: "gpt-5.4", displayName: "GPT-5.4" },
  { id: "gpt-5.4-mini", displayName: "GPT-5.4 mini" },
  { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" },
];

// Reassemble the SSE stream into the final assistant text + token usage. The
// Responses API emits incremental `response.output_text.delta` events and a
// terminal `response.completed` event carrying the full object (incl. usage).
async function readResponsesStream(
  res: Response,
): Promise<{ text: string; tokensInput: number; tokensOutput: number }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Codex response had no body.");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let tokensInput = 0;
  let tokensOutput = 0;

  const handleEvent = (raw: string) => {
    // Each SSE block is one or more `data: {...}` lines.
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let evt: {
        type?: string;
        delta?: string;
        response?: {
          output_text?: string;
          output?: { content?: { type?: string; text?: string }[] }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
        text += evt.delta;
      } else if (evt.type === "response.completed" && evt.response) {
        // Prefer the assembled deltas; fall back to the final object if we got
        // no deltas (some models return the whole thing at once).
        if (!text) {
          text =
            evt.response.output_text ??
            evt.response.output
              ?.flatMap((o) => o.content ?? [])
              .filter((c) => c.type === "output_text")
              .map((c) => c.text ?? "")
              .join("") ??
            "";
        }
        tokensInput = evt.response.usage?.input_tokens ?? tokensInput;
        tokensOutput = evt.response.usage?.output_tokens ?? tokensOutput;
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by a blank line.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      handleEvent(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) handleEvent(buffer);
  return { text, tokensInput, tokensOutput };
}

/**
 * Build the provider-agnostic `complete` closure for a Codex subscription. Takes
 * the plaintext OAuth access token + the ChatGPT account id; speaks the Responses
 * API and folds the streamed reply back into a single string.
 */
export function codexComplete(accessToken: string, accountId: string, model: string) {
  return async ({ system, user, maxTokens }: CompletionRequest): Promise<CompletionResult> => {
    const res = await fetch(`${CODEX_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        "chatgpt-account-id": accountId,
        // The Codex CLI tags its requests; the backend expects an originator.
        originator: "codex_cli_rs",
        "openai-beta": "responses=experimental",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        // Responses API message shape (NOT Chat Completions). The system prompt
        // goes in `instructions`; the user turn is a typed input_text block.
        instructions: system,
        input: [
          { role: "user", content: [{ type: "input_text", text: user }] },
        ],
        max_output_tokens: maxTokens,
        // Subscription requests must be stateless: never let the backend persist.
        store: false,
        stream: true,
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(
        `Codex request failed (${res.status}). ${detail || "Reconnect the Codex subscription in Settings → AI."}`,
      );
    }
    return await readResponsesStream(res);
  };
}

/** Codex subscription has no live model list for our token — return the static menu. */
export function codexListModels(): Promise<{ models: ModelOption[]; live: boolean }> {
  return Promise.resolve({ models: CODEX_FALLBACK_MODELS, live: false });
}
