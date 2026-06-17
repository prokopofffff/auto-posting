"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { encrypt } from "@/lib/crypto";
import { getCurrentUser, userOwnsProject } from "@/server/project";
import { invokeEdge } from "@/server/edge";
import { startLogin, exchangeCode } from "@/lib/claude-oauth";

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

function revalidate() {
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

// ── Claude Max subscription: PKCE "login with code" ──────────────────────────

export async function startClaudeLoginAction(projectId: string) {
  const g = await guard(projectId);
  if (!g.ok) return g;
  // The verifier + state are returned to the client and echoed back to
  // `connectClaudeSubscriptionAction`. This is the standard PKCE public-client
  // model; the verifier is single-use and worthless without the matching code,
  // which only the user (who completes the consent screen) ever sees.
  const { url, verifier, state } = startLogin();
  return { ok: true as const, url, verifier, state };
}

const subscriptionSchema = z.object({
  projectId: z.string().min(1),
  code: z.string().min(1),
  verifier: z.string().min(1),
  state: z.string().min(1),
});

export async function connectClaudeSubscriptionAction(
  input: z.input<typeof subscriptionSchema>,
) {
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
  revalidate();
  return { ok: true as const };
}

// The one rule: when a write switches the active provider, the stored `model`
// (a Claude id vs a DeepSeek id) no longer applies, so null it; same-provider
// writes keep the chosen model. Both the connect upserts and the active-switch
// update funnel through this so the rule lives in one place.
function modelResetOnSwitch(
  current: "ANTHROPIC" | "DEEPSEEK" | null | undefined,
  next: "ANTHROPIC" | "DEEPSEEK",
): { model?: null } {
  return current && current !== next ? { model: null } : {};
}

// Connect actions don't hold the current row, so read just its provider first.
async function clearModelOnProviderSwitch(
  projectId: string,
  next: "ANTHROPIC" | "DEEPSEEK",
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

export async function connectClaudeApiKeyAction(input: z.input<typeof apiKeySchema>) {
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
  revalidate();
  return { ok: true as const };
}

// ── DeepSeek API key ───────────────────────────────────────────────────────

// Same shape as a Claude API key (an opaque bearer string), so it reuses
// apiKeySchema rather than declaring an identical one.
export async function connectDeepSeekApiKeyAction(input: z.input<typeof apiKeySchema>) {
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
  revalidate();
  return { ok: true as const };
}

// ── Active-credential switch & model ────────────────────────────────────────

// Which connected credential the project generates with. Maps a UI "kind" to
// the (provider, mode) pair and validates the matching secret exists.
const KIND = {
  CLAUDE_API_KEY: { provider: "ANTHROPIC", mode: "API_KEY" },
  CLAUDE_SUBSCRIPTION: { provider: "ANTHROPIC", mode: "SUBSCRIPTION" },
  DEEPSEEK: { provider: "DEEPSEEK" },
} as const;

export type AiCredentialKind = keyof typeof KIND;

export async function setAiCredentialAction(projectId: string, kind: AiCredentialKind) {
  const g = await guard(projectId);
  if (!g.ok) return g;
  const { data: cred } = await supabaseAdmin
    .from("AiCredential")
    .select("apiKey, oauthAccessToken, deepseekApiKey, provider")
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
  revalidate();
  return { ok: true as const };
}

const modelSchema = z.object({
  projectId: z.string().min(1),
  model: z.string().trim().min(1).max(120),
});

export async function setAiModelAction(input: z.input<typeof modelSchema>) {
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: firstIssue(parsed.error) };
  }
  const { projectId, model } = parsed.data;
  const g = await guard(projectId);
  if (!g.ok) return g;
  await unwrap(supabaseAdmin.from("AiCredential").update({ model }).eq("projectId", projectId));
  revalidate();
  return { ok: true as const };
}

export async function listAiModelsAction(projectId: string) {
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
}

export async function disconnectAiCredentialAction(projectId: string) {
  const g = await guard(projectId);
  if (!g.ok) return g;
  await unwrap(supabaseAdmin.from("AiCredential").delete().eq("projectId", projectId));
  revalidate();
  return { ok: true as const };
}
