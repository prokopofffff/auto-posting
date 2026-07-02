import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { encrypt } from "@/lib/crypto";
import { getCurrentUser, userOwnsProject } from "@/server/project";
import { invokeEdge } from "@/server/edge";
import { startLogin, exchangeCode } from "@/lib/claude-oauth";
import {
  startLogin as startCodexLogin,
  exchangeCode as exchangeCodexCode,
} from "@/lib/codex-oauth";

// Every action below first verifies the signed-in user owns `projectId`, and
// stamps `createdBy` with their id. Combined with the per-project unique
// constraint + RLS, a user can only ever read/write their OWN project's
// credential — never another user's API key or subscription.
function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input.";
}

async function guard(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!(await userOwnsProject(user.id, projectId))) {
    return { ok: false as const, error: "Project not found." };
  }
  return { ok: true as const, user };
}

// ── Claude Max subscription: PKCE "login with code" ──────────────────────────

// Calling convention from a client component:
//   await startClaudeLoginAction({ data: projectId })
export const startClaudeLoginAction = createServerFn({ method: "POST" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }) => {
    const g = await guard(projectId);
    if (!g.ok) return g;
    // The verifier + state are returned to the client and echoed back to
    // `connectClaudeSubscriptionAction`. This is the standard PKCE public-client
    // model; the verifier is single-use and worthless without the matching code,
    // which only the user (who completes the consent screen) ever sees.
    const { url, verifier, state } = startLogin();
    return { ok: true as const, url, verifier, state };
  });

const subscriptionSchema = z.object({
  projectId: z.string().min(1),
  code: z.string().min(1),
  verifier: z.string().min(1),
  state: z.string().min(1),
});

// Calling convention from a client component:
//   await connectClaudeSubscriptionAction({ data: { projectId, code, verifier, state } })
export const connectClaudeSubscriptionAction = createServerFn({ method: "POST" })
  .validator((input: z.input<typeof subscriptionSchema>) => input)
  .handler(async ({ data: input }) => {
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: firstIssue(parsed.error) };
    }
    const { projectId, code, verifier, state } = parsed.data;
    const g = await guard(projectId);
    if (!g.ok) return g;

    let tokens;
    try {
      tokens = await exchangeCode(code, verifier, state);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }

    const expiresAt = new Date(
      Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ).toISOString();

    await unwrap(
      supabaseAdmin.from("AiCredential").upsert(
        {
          projectId,
          provider: "ANTHROPIC",
          mode: "SUBSCRIPTION",
          oauthAccessToken: await encrypt(tokens.access_token),
          oauthRefreshToken: tokens.refresh_token
            ? await encrypt(tokens.refresh_token)
            : null,
          oauthExpiresAt: expiresAt,
          createdBy: g.user.id,
          // Connecting Claude makes it the active provider; drop a DeepSeek model
          // id so the picker falls back to the Claude default.
          ...(await clearModelOnProviderSwitch(projectId, "ANTHROPIC")),
        },
        { onConflict: "projectId" },
      ),
    );
    return { ok: true as const };
  });

// The one rule: when a write switches the active provider, the stored `model`
// (a Claude id vs a DeepSeek id) no longer applies, so null it; same-provider
// writes keep the chosen model. Both the connect upserts and the active-switch
// update funnel through this so the rule lives in one place.
function modelResetOnSwitch(
  current: "ANTHROPIC" | "DEEPSEEK" | "OPENAI" | null | undefined,
  next: "ANTHROPIC" | "DEEPSEEK" | "OPENAI",
): { model?: null } {
  return current && current !== next ? { model: null } : {};
}

// Connect actions don't hold the current row, so read just its provider first.
async function clearModelOnProviderSwitch(
  projectId: string,
  next: "ANTHROPIC" | "DEEPSEEK" | "OPENAI",
): Promise<{ model?: null }> {
  const { data } = await supabaseAdmin
    .from("AiCredential")
    .select("provider")
    .eq("projectId", projectId)
    .maybeSingle();
  return modelResetOnSwitch(data?.provider, next);
}

// ── API key ──────────────────────────────────────────────────────────────────

const apiKeySchema = z.object({
  projectId: z.string().min(1),
  apiKey: z.string().trim().min(20, "That doesn't look like a valid API key."),
});

// Calling convention from a client component:
//   await connectClaudeApiKeyAction({ data: { projectId, apiKey } })
export const connectClaudeApiKeyAction = createServerFn({ method: "POST" })
  .validator((input: z.input<typeof apiKeySchema>) => input)
  .handler(async ({ data: input }) => {
    const parsed = apiKeySchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: firstIssue(parsed.error) };
    }
    const { projectId, apiKey } = parsed.data;
    const g = await guard(projectId);
    if (!g.ok) return g;

    await unwrap(
      supabaseAdmin.from("AiCredential").upsert(
        {
          projectId,
          provider: "ANTHROPIC",
          mode: "API_KEY",
          apiKey: await encrypt(apiKey),
          createdBy: g.user.id,
          ...(await clearModelOnProviderSwitch(projectId, "ANTHROPIC")),
        },
        { onConflict: "projectId" },
      ),
    );
    return { ok: true as const };
  });

// ── DeepSeek API key ───────────────────────────────────────────────────────

// Same shape as a Claude API key (an opaque bearer string), so it reuses
// apiKeySchema rather than declaring an identical one.
// Calling convention from a client component:
//   await connectDeepSeekApiKeyAction({ data: { projectId, apiKey } })
export const connectDeepSeekApiKeyAction = createServerFn({ method: "POST" })
  .validator((input: z.input<typeof apiKeySchema>) => input)
  .handler(async ({ data: input }) => {
    const parsed = apiKeySchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: firstIssue(parsed.error) };
    }
    const { projectId, apiKey } = parsed.data;
    const g = await guard(projectId);
    if (!g.ok) return g;

    await unwrap(
      supabaseAdmin.from("AiCredential").upsert(
        {
          projectId,
          provider: "DEEPSEEK",
          deepseekApiKey: await encrypt(apiKey),
          createdBy: g.user.id,
          ...(await clearModelOnProviderSwitch(projectId, "DEEPSEEK")),
        },
        { onConflict: "projectId" },
      ),
    );
    return { ok: true as const };
  });

// ── OpenAI API key ───────────────────────────────────────────────────────────

// Calling convention from a client component:
//   await connectOpenAiApiKeyAction({ data: { projectId, apiKey } })
export const connectOpenAiApiKeyAction = createServerFn({ method: "POST" })
  .validator((input: z.input<typeof apiKeySchema>) => input)
  .handler(async ({ data: input }) => {
    const parsed = apiKeySchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: firstIssue(parsed.error) };
    }
    const { projectId, apiKey } = parsed.data;
    const g = await guard(projectId);
    if (!g.ok) return g;

    await unwrap(
      supabaseAdmin.from("AiCredential").upsert(
        {
          projectId,
          provider: "OPENAI",
          mode: "API_KEY",
          openaiApiKey: await encrypt(apiKey),
          createdBy: g.user.id,
          ...(await clearModelOnProviderSwitch(projectId, "OPENAI")),
        },
        { onConflict: "projectId" },
      ),
    );
    return { ok: true as const };
  });

// ── Codex subscription: PKCE "login with code" ───────────────────────────────

// Calling convention from a client component:
//   await startCodexLoginAction({ data: projectId })
export const startCodexLoginAction = createServerFn({ method: "POST" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }) => {
    const g = await guard(projectId);
    if (!g.ok) return g;
    const { url, verifier, state } = startCodexLogin();
    return { ok: true as const, url, verifier, state };
  });

const codexSubscriptionSchema = z.object({
  projectId: z.string().min(1),
  code: z.string().min(1),
  verifier: z.string().min(1),
  state: z.string().min(1),
});

// Calling convention from a client component:
//   await connectCodexSubscriptionAction({ data: { projectId, code, verifier, state } })
export const connectCodexSubscriptionAction = createServerFn({ method: "POST" })
  .validator((input: z.input<typeof codexSubscriptionSchema>) => input)
  .handler(async ({ data: input }) => {
    const parsed = codexSubscriptionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: firstIssue(parsed.error) };
    }
    const { projectId, code, verifier, state } = parsed.data;
    const g = await guard(projectId);
    if (!g.ok) return g;

    let tokens;
    try {
      tokens = await exchangeCodexCode(code, verifier, state);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }

    if (!tokens.account_id) {
      return {
        ok: false as const,
        error: "Could not read your ChatGPT account from the login. Try connecting again.",
      };
    }

    const expiresAt = new Date(
      Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ).toISOString();

    await unwrap(
      supabaseAdmin.from("AiCredential").upsert(
        {
          projectId,
          provider: "OPENAI",
          mode: "SUBSCRIPTION",
          codexOauthAccessToken: await encrypt(tokens.access_token),
          codexOauthRefreshToken: tokens.refresh_token
            ? await encrypt(tokens.refresh_token)
            : null,
          codexOauthExpiresAt: expiresAt,
          codexAccountId: tokens.account_id,
          createdBy: g.user.id,
          ...(await clearModelOnProviderSwitch(projectId, "OPENAI")),
        },
        { onConflict: "projectId" },
      ),
    );
    return { ok: true as const };
  });

// ── Active-credential switch & model ────────────────────────────────────────

// Which connected credential the project generates with. Maps a UI "kind" to
// the (provider, mode) pair and validates the matching secret exists.
const KIND = {
  CLAUDE_API_KEY: { provider: "ANTHROPIC", mode: "API_KEY" },
  CLAUDE_SUBSCRIPTION: { provider: "ANTHROPIC", mode: "SUBSCRIPTION" },
  DEEPSEEK: { provider: "DEEPSEEK" },
  OPENAI_API_KEY: { provider: "OPENAI", mode: "API_KEY" },
  CODEX_SUBSCRIPTION: { provider: "OPENAI", mode: "SUBSCRIPTION" },
} as const;

export type AiCredentialKind = keyof typeof KIND;

// Calling convention from a client component:
//   await setAiCredentialAction({ data: { projectId, kind } })
export const setAiCredentialAction = createServerFn({ method: "POST" })
  .validator((input: { projectId: string; kind: AiCredentialKind }) => input)
  .handler(async ({ data: { projectId, kind } }) => {
    const g = await guard(projectId);
    if (!g.ok) return g;
    const { data: cred } = await supabaseAdmin
      .from("AiCredential")
      .select("apiKey, oauthAccessToken, deepseekApiKey, openaiApiKey, codexOauthAccessToken, provider")
      .eq("projectId", projectId)
      .maybeSingle();
    if (!cred) return { ok: false as const, error: "Connect a credential first." };

    if (kind === "CLAUDE_API_KEY" && !cred.apiKey) {
      return { ok: false as const, error: "No Claude API key connected." };
    }
    if (kind === "CLAUDE_SUBSCRIPTION" && !cred.oauthAccessToken) {
      return { ok: false as const, error: "No Claude subscription connected." };
    }
    if (kind === "DEEPSEEK" && !cred.deepseekApiKey) {
      return { ok: false as const, error: "No DeepSeek API key connected." };
    }
    if (kind === "OPENAI_API_KEY" && !cred.openaiApiKey) {
      return { ok: false as const, error: "No OpenAI API key connected." };
    }
    if (kind === "CODEX_SUBSCRIPTION" && !cred.codexOauthAccessToken) {
      return { ok: false as const, error: "No Codex subscription connected." };
    }

    const target = KIND[kind];
    await unwrap(
      supabaseAdmin
        .from("AiCredential")
        .update({
          provider: target.provider,
          // DeepSeek ignores `mode`; leave it as-is for that kind.
          ...("mode" in target ? { mode: target.mode } : {}),
          ...modelResetOnSwitch(cred.provider, target.provider),
        })
        .eq("projectId", projectId),
    );
    return { ok: true as const };
  });

const modelSchema = z.object({
  projectId: z.string().min(1),
  model: z.string().trim().min(1).max(120),
});

// Calling convention from a client component:
//   await setAiModelAction({ data: { projectId, model } })
export const setAiModelAction = createServerFn({ method: "POST" })
  .validator((input: z.input<typeof modelSchema>) => input)
  .handler(async ({ data: input }) => {
    const parsed = modelSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: firstIssue(parsed.error) };
    }
    const { projectId, model } = parsed.data;
    const g = await guard(projectId);
    if (!g.ok) return g;
    await unwrap(supabaseAdmin.from("AiCredential").update({ model }).eq("projectId", projectId));
    return { ok: true as const };
  });

// Calling convention from a client component:
//   await listAiModelsAction({ data: projectId })
export const listAiModelsAction = createServerFn({ method: "POST" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }) => {
    const g = await guard(projectId);
    if (!g.ok) return g;
    try {
      const res = await invokeEdge<
        | { ok: true; models: { id: string; displayName: string }[]; live: boolean }
        | { ok: false; error: string }
      >("list-models", { projectId });
      if (!res.ok) return { ok: false as const, error: res.error };
      return { ok: true as const, models: res.models, live: res.live };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

// Calling convention from a client component:
//   await disconnectAiCredentialAction({ data: projectId })
export const disconnectAiCredentialAction = createServerFn({ method: "POST" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }) => {
    const g = await guard(projectId);
    if (!g.ok) return g;
    await unwrap(supabaseAdmin.from("AiCredential").delete().eq("projectId", projectId));
    return { ok: true as const };
  });
