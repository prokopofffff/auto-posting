// Codex "login with code" — the OAuth PKCE flow that the Codex CLI uses to sign
// in with a ChatGPT subscription. Mirrors claude-oauth.ts in shape, with two
// Codex-specific wrinkles:
//
//   1. The registered redirect URI is a fixed localhost callback
//      (http://localhost:1455/auth/callback) — OpenAI rejects any other value.
//      There is no "show a copyable code" screen like Claude's, so after the user
//      approves, the browser lands on a dead localhost page whose URL carries
//      ?code=...&state=.... The user copies that whole URL (or just the code) back
//      to us; exchangeCode() accepts either form.
//
//   2. Generation needs the user's ChatGPT account id (the `chatgpt_account_id`
//      JWT claim) as a header on every request, so exchangeCode() also decodes it
//      out of the returned id_token / access_token and returns it to be stored.
//
// These are PUBLIC client values (PKCE, no client secret) — the same ones the
// open-source Codex CLI ships with. Token refresh happens at use time in the edge
// resolver (supabase/functions/tick/lib/ai-credentials.ts).
import { createHash, randomBytes } from "node:crypto";

// The Codex CLI's public OAuth client. Not a secret.
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
// Must match the value registered for the client exactly — OpenAI only accepts
// this localhost callback. The page won't load for the user (we run no local
// server); they just copy the code out of the URL bar.
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPES = "openid profile email offline_access";

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export type PkceStart = {
  url: string;
  verifier: string;
  state: string;
};

/** Build the authorize URL + the PKCE verifier/state the caller must keep. */
export function startLogin(): PkceStart {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(32));

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CODEX_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  // The two flags the Codex CLI sets so the id_token carries org/account claims
  // and the consent screen uses the simplified Codex copy.
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");

  return { url: url.toString(), verifier, state };
}

export type CodexTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number; // seconds
  /** ChatGPT account id, decoded from the returned JWT (header on every request). */
  account_id: string | null;
};

/** Decode a JWT payload (base64url) without verifying — we only read claims. */
function decodeJwtPayload(jwt: string | undefined): Record<string, unknown> | null {
  if (!jwt) return null;
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// The account id lives under one of a few claim shapes depending on the token;
// try them in the order the Codex CLI does.
function accountIdFromJwt(jwt: string | undefined): string | null {
  const claims = decodeJwtPayload(jwt);
  if (!claims) return null;
  if (typeof claims["chatgpt_account_id"] === "string") {
    return claims["chatgpt_account_id"] as string;
  }
  const auth = claims["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: string; organizations?: { id?: string }[] }
    | undefined;
  if (auth?.chatgpt_account_id) return auth.chatgpt_account_id;
  if (auth?.organizations?.[0]?.id) return auth.organizations[0].id;
  return null;
}

/** Pull the bare authorization code + state out of whatever the user pasted:
 *  the full `http://localhost:1455/auth/callback?code=...&state=...` URL, or a
 *  `code#state` / `code` string (matching the Claude flow's affordance). */
function parsePastedCode(pasted: string): { code: string; state: string | null } {
  const trimmed = pasted.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      const code = u.searchParams.get("code") ?? "";
      return { code, state: u.searchParams.get("state") };
    } catch {
      // fall through to the non-URL parse
    }
  }
  const [code, state] = trimmed.split("#");
  return { code: code ?? "", state: state ?? null };
}

/**
 * Exchange the pasted callback URL / code for tokens. `expectedState` is the
 * state from startLogin(); when the pasted value carries a state it must match
 * (CSRF binding). Also decodes and returns the ChatGPT account id.
 */
export async function exchangeCode(
  pasted: string,
  verifier: string,
  expectedState: string,
): Promise<CodexTokens> {
  const { code, state } = parsePastedCode(pasted);
  if (!code) throw new Error("That doesn't look like a valid code.");
  if (state && state !== expectedState) {
    throw new Error("Authorization state mismatch — start the connect flow again.");
  }

  // The token endpoint expects form-encoded params (matching the Codex CLI).
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CODEX_OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Codex token exchange failed (${res.status}). ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  // Account id is in the id_token first, with the access_token as a fallback.
  const account_id =
    accountIdFromJwt(json.id_token) ?? accountIdFromJwt(json.access_token);

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in,
    account_id,
  };
}
