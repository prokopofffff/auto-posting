// Claude Max "login with code" — the OAuth PKCE flow used by `claude
// setup-token`. The user opens the authorize URL, approves, and Claude shows a
// one-time code (formatted `<code>#<state>`) to paste back. We exchange it for
// an access/refresh token pair, which is stored encrypted per project.
//
// This is a PUBLIC OAuth client (PKCE, no client secret) — the client id and
// endpoints below are not secrets. Token refresh happens at use time in the
// edge resolver (supabase/functions/tick/lib/ai-credentials.ts).
import { createHash, randomBytes } from "node:crypto";

export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

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
  const state = base64url(randomBytes(16));

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("code", "true"); // show a copyable code instead of redirecting
  url.searchParams.set("client_id", CLAUDE_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);

  return { url: url.toString(), verifier, state };
}

export type ClaudeTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number; // seconds
};

/**
 * Exchange the pasted `<code>#<state>` for tokens. `expectedState` is the state
 * from startLogin(); the pasted state must match it (CSRF binding).
 */
export async function exchangeCode(
  pasted: string,
  verifier: string,
  expectedState: string,
): Promise<ClaudeTokens> {
  const [code, returnedState] = pasted.trim().split("#");
  if (!code) throw new Error("That doesn't look like a valid code.");
  // Claude appends the state after '#'; if present it must match what we issued.
  if (returnedState && returnedState !== expectedState) {
    throw new Error("Authorization state mismatch — start the connect flow again.");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      state: returnedState ?? expectedState,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Claude token exchange failed (${res.status}). ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as ClaudeTokens;
}
