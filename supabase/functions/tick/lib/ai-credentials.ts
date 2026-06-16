// Per-project Claude credential resolver — the single place credentials are
// turned into a ready-to-use Anthropic client. Lives in the Edge Function (the
// one generation runtime); the Next app reaches it over HTTP (see
// src/server/edge.ts), so there is no second copy of this logic to drift.
//
// Two modes (see migration 20260616000000_ai_credentials.sql):
//   API_KEY      → a console.anthropic.com key, sent as x-api-key.
//   SUBSCRIPTION → a Claude Max OAuth token pair, sent as Authorization: Bearer
//                  + the oauth beta header + the Claude Code system preamble.
//
// SECURITY: the credential is looked up ONLY by the projectId being processed.
// There is no env-var fallback and no shared key — a project can never spend
// another project's credential. Secrets are stored encrypted and decrypted here
// at use time.
import Anthropic from "npm:@anthropic-ai/sdk@0.90.0";
import { decrypt } from "./crypto.ts";
import { supabaseAdmin, unwrap } from "./supabase.ts";
import { getValidAccessToken, type RefreshedTokens } from "./oauth-refresh.ts";

export const OAUTH_BETA_HEADER = "oauth-2025-04-20";
export const CLAUDE_CODE_PREAMBLE =
  "You are Claude Code, Anthropic's official CLI for Claude.";

// Public Claude OAuth client (the same values `claude setup-token` uses). These
// are NOT secrets — the flow is PKCE with no client secret.
export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";

// The one hard-coded fallback: used only when a project has connected a
// credential but not yet picked a model. The actual model menu is fetched live
// from the Models API (listModels), so model launches need no code change.
export const DEFAULT_MODEL = "claude-haiku-4-5";

// Refresh ~1 min early so a token doesn't expire mid-request.
const REFRESH_SKEW_MS = 60_000;

export type ResolvedClaude = {
  client: Anthropic;
  model: string;
  oauth: boolean;
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

/**
 * Resolve the Claude client + model for a project, or throw a clear,
 * user-facing error when no credential is connected. For SUBSCRIPTION mode,
 * refreshes and persists the OAuth token when it is close to expiry.
 */
export async function resolveClaude(projectId: string): Promise<ResolvedClaude> {
  const cred = await unwrap(
    supabaseAdmin
      .from("AiCredential")
      .select("*")
      .eq("projectId", projectId)
      .maybeSingle(),
  );
  if (!cred) {
    throw new Error(
      "No Claude credential connected for this project. Connect one in Settings → AI.",
    );
  }

  const model = cred.model ?? DEFAULT_MODEL;

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

    return {
      client: new Anthropic({
        authToken: accessToken,
        apiKey: null,
        defaultHeaders: { "anthropic-beta": OAUTH_BETA_HEADER },
      }),
      model,
      oauth: true,
    };
  }

  // API_KEY
  if (!cred.apiKey) {
    throw new Error("No Claude API key set. Add one in Settings → AI.");
  }
  const apiKey = await decrypt(cred.apiKey);
  return { client: new Anthropic({ apiKey }), model, oauth: false };
}

export type ModelOption = { id: string; displayName: string };

// A small, sensible fallback for the picker when the live Models API can't be
// reached (e.g. a subscription token whose scopes don't permit /v1/models).
// Haiku first so it stays the default. Not authoritative — the live list wins.
const FALLBACK_MODELS: ModelOption[] = [
  { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
];

/**
 * Live model list for the project's connected credential. New models appear
 * automatically (no hard-coded catalog). Falls back to a minimal list if the
 * Models API is unavailable for this credential.
 */
export async function listModels(
  projectId: string,
): Promise<{ models: ModelOption[]; live: boolean }> {
  const { client } = await resolveClaude(projectId);
  try {
    const models: ModelOption[] = [];
    for await (const m of client.models.list()) {
      models.push({ id: m.id, displayName: m.display_name ?? m.id });
    }
    if (models.length === 0) return { models: FALLBACK_MODELS, live: false };
    return { models, live: true };
  } catch {
    return { models: FALLBACK_MODELS, live: false };
  }
}
