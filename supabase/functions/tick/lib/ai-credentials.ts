// Per-project AI credential resolver — the single place a stored credential is
// turned into a ready-to-use model client. Lives in the Edge Function (the one
// generation runtime); the Next app reaches it over HTTP (see src/server/edge.ts),
// so there is no second copy of this logic to drift.
//
// Two providers (see migration 20260617000000_ai_provider_deepseek.sql):
//   ANTHROPIC → Claude, in one of two modes:
//       API_KEY      → a console.anthropic.com key, sent as x-api-key.
//       SUBSCRIPTION → a Claude Max OAuth token pair, sent as Authorization:
//                      Bearer + the oauth beta header + the Claude Code preamble.
//   DEEPSEEK  → a DeepSeek platform key (OpenAI-compatible), sent as Bearer.
//
// Callers don't branch on provider: resolveModel returns a `complete` /
// `listModels` closure that hides the per-provider wire format. So claude.ts and
// moderation.ts call resolved.complete(...) without knowing which model answered.
//
// SECURITY: the credential is looked up ONLY by the projectId being processed.
// There is no env-var fallback and no shared key — a project can never spend
// another project's credential. Secrets are stored encrypted and decrypted here
// at use time.
import Anthropic from "npm:@anthropic-ai/sdk@0.90.0";
import { decrypt } from "./crypto.ts";
import { supabaseAdmin, unwrap } from "./supabase.ts";
import { getValidAccessToken, type RefreshedTokens } from "./oauth-refresh.ts";
import {
  DEEPSEEK_DEFAULT_MODEL,
  deepseekComplete,
  deepseekListModels,
  isDeepSeekModel,
} from "./deepseek.ts";

export const OAUTH_BETA_HEADER = "oauth-2025-04-20";
export const CLAUDE_CODE_PREAMBLE =
  "You are Claude Code, Anthropic's official CLI for Claude.";

// Public Claude OAuth client (the same values `claude setup-token` uses). These
// are NOT secrets — the flow is PKCE with no client secret.
export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";

// The one hard-coded Claude fallback: used only when an Anthropic project has
// connected a credential but not yet picked a model. The actual model menu is
// fetched live from the Models API (listModels), so model launches need no
// code change. DeepSeek's default lives in deepseek.ts.
export const DEFAULT_MODEL = "claude-haiku-4-5";

// Refresh ~1 min early so a token doesn't expire mid-request.
const REFRESH_SKEW_MS = 60_000;

export type ModelOption = { id: string; displayName: string };

// The provider-agnostic completion contract. A single system + user string in,
// text plus token counts out. Both providers' closures conform to this.
export type CompletionRequest = { system: string; user: string; maxTokens: number };
export type CompletionResult = { text: string; tokensInput: number; tokensOutput: number };

export type AiProvider = "ANTHROPIC" | "DEEPSEEK";

/**
 * A resolved, ready-to-call model. `complete` runs one turn; `listModels`
 * returns the picker menu for this credential. Neither caller needs to know the
 * provider — that's the point.
 */
export type ResolvedModel = {
  provider: AiProvider;
  model: string;
  complete: (req: CompletionRequest) => Promise<CompletionResult>;
  listModels: () => Promise<{ models: ModelOption[]; live: boolean }>;
};

async function refreshSubscriptionToken(refreshToken: string): Promise<RefreshedTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Claude subscription token refresh failed (${res.status}). Reconnect in Settings → AI.`,
    );
  }
  return (await res.json()) as RefreshedTokens;
}

// A small, sensible fallback for the picker when the live Models API can't be
// reached (e.g. a subscription token whose scopes don't permit /v1/models).
// Haiku first so it stays the default. Not authoritative — the live list wins.
const ANTHROPIC_FALLBACK_MODELS: ModelOption[] = [
  { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
];

/** Build the provider-agnostic closures for a resolved Anthropic client + model. */
function anthropicResolved(
  client: Anthropic,
  model: string,
  oauth: boolean,
): ResolvedModel {
  return {
    provider: "ANTHROPIC",
    model,
    complete: async ({ system, user, maxTokens }) => {
      const systemBlocks: Anthropic.TextBlockParam[] = [];
      // The Claude Code preamble is required when authenticating with a Max
      // subscription OAuth token; harmless to omit for API keys.
      if (oauth) systemBlocks.push({ type: "text", text: CLAUDE_CODE_PREAMBLE });
      systemBlocks.push({
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      });
      // No `thinking` / `effort` / sampling params: the model is user-selectable
      // (default Haiku), and omitting these keeps the call valid across every
      // model the picker can offer — including ones that 400 on adaptive thinking.
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemBlocks,
        messages: [{ role: "user", content: user }],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const usage = response.usage;
      // Count every input bucket: fresh, cache reads, and cache *writes* (cache
      // misses — the common case here since pipeline runs are spaced well beyond
      // the ephemeral TTL).
      const tokensInput =
        (usage?.input_tokens ?? 0) +
        (usage?.cache_read_input_tokens ?? 0) +
        (usage?.cache_creation_input_tokens ?? 0);
      return { text, tokensInput, tokensOutput: usage?.output_tokens ?? 0 };
    },
    listModels: async () => {
      try {
        const models: ModelOption[] = [];
        for await (const m of client.models.list()) {
          models.push({ id: m.id, displayName: m.display_name ?? m.id });
        }
        if (models.length === 0) return { models: ANTHROPIC_FALLBACK_MODELS, live: false };
        return { models, live: true };
      } catch {
        return { models: ANTHROPIC_FALLBACK_MODELS, live: false };
      }
    },
  };
}

/**
 * Resolve the model client for a project, or throw a clear, user-facing error
 * when no credential is connected. For an Anthropic SUBSCRIPTION credential,
 * refreshes and persists the OAuth token when it is close to expiry.
 */
export async function resolveModel(projectId: string): Promise<ResolvedModel> {
  const cred = await unwrap(
    supabaseAdmin
      .from("AiCredential")
      .select("*")
      .eq("projectId", projectId)
      .maybeSingle(),
  );
  if (!cred) {
    throw new Error(
      "No AI credential connected for this project. Connect one in Settings → AI.",
    );
  }

  // ── DeepSeek ────────────────────────────────────────────────────────────
  if (cred.provider === "DEEPSEEK") {
    if (!cred.deepseekApiKey) {
      throw new Error("No DeepSeek API key set. Add one in Settings → AI.");
    }
    const apiKey = await decrypt(cred.deepseekApiKey);
    // Guard against a leftover Claude model id selected before the switch.
    const model = isDeepSeekModel(cred.model) ? cred.model! : DEEPSEEK_DEFAULT_MODEL;
    return {
      provider: "DEEPSEEK",
      model,
      complete: deepseekComplete(apiKey, model),
      listModels: () => deepseekListModels(apiKey),
    };
  }

  // ── Anthropic ───────────────────────────────────────────────────────────
  // Guard against a leftover DeepSeek model id selected before the switch.
  const model = cred.model && !isDeepSeekModel(cred.model) ? cred.model : DEFAULT_MODEL;

  if (cred.mode === "SUBSCRIPTION") {
    if (!cred.oauthAccessToken) {
      throw new Error("Claude subscription is not connected. Reconnect in Settings → AI.");
    }
    // Shared refresh-and-persist dance (also used by the LinkedIn resolver).
    // No onMissingRefreshToken → falls back to the current token rather than
    // hard-failing when there's nothing to refresh with.
    const accessToken = await getValidAccessToken(
      {
        accessToken: cred.oauthAccessToken,
        refreshToken: cred.oauthRefreshToken,
        expiresAt: cred.oauthExpiresAt,
      },
      {
        skewMs: REFRESH_SKEW_MS,
        refresh: refreshSubscriptionToken,
        persist: async ({ accessToken, refreshToken, expiresAt }) => {
          await unwrap(
            supabaseAdmin
              .from("AiCredential")
              .update({
                oauthAccessToken: accessToken,
                oauthRefreshToken: refreshToken,
                oauthExpiresAt: expiresAt,
              })
              .eq("id", cred.id),
          );
        },
      },
    );

    return anthropicResolved(
      new Anthropic({
        authToken: accessToken,
        apiKey: null,
        defaultHeaders: { "anthropic-beta": OAUTH_BETA_HEADER },
      }),
      model,
      true,
    );
  }

  // API_KEY
  if (!cred.apiKey) {
    throw new Error("No Claude API key set. Add one in Settings → AI.");
  }
  const apiKey = await decrypt(cred.apiKey);
  return anthropicResolved(new Anthropic({ apiKey }), model, false);
}

/**
 * Live model list for the project's connected credential. New models appear
 * automatically (no hard-coded catalog). Falls back to a minimal list if the
 * provider's Models API is unavailable for this credential.
 */
export async function listModels(
  projectId: string,
): Promise<{ models: ModelOption[]; live: boolean }> {
  const resolved = await resolveModel(projectId);
  return resolved.listModels();
}
