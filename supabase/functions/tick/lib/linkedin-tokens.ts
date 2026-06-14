// Valid-token resolver for LinkedIn publishing, ported from
// src/server/linkedin-tokens.ts. Refreshes an expiring token (re-encrypting the
// new credentials before persisting) and returns a usable bearer token.
import { supabaseAdmin, unwrap } from "./supabase.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { refreshAccessToken, type LinkedInTokenResponse } from "./linkedin.ts";
import type { ConnectedAccount } from "./types.ts";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class LinkedInReconnectRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkedInReconnectRequiredError";
  }
}

export async function getValidLinkedInAccessToken(
  conn: ConnectedAccount,
): Promise<string> {
  if (!conn.accessToken) {
    throw new LinkedInReconnectRequiredError(
      "LinkedIn account is not connected — reconnect in Settings.",
    );
  }

  const expiresAtMs = conn.expiresAt ? new Date(conn.expiresAt).getTime() : null;
  const needsRefresh =
    expiresAtMs !== null && expiresAtMs - Date.now() < REFRESH_BUFFER_MS;

  if (!needsRefresh) {
    return await decrypt(conn.accessToken);
  }

  if (!conn.refreshToken) {
    throw new LinkedInReconnectRequiredError(
      "LinkedIn token expired and no refresh token is stored — reconnect the account in Settings.",
    );
  }

  let tokens: LinkedInTokenResponse;
  try {
    tokens = await refreshAccessToken(await decrypt(conn.refreshToken));
  } catch (e) {
    throw new LinkedInReconnectRequiredError(
      `LinkedIn token refresh failed — reconnect the account in Settings. (${(e as Error).message})`,
    );
  }

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const accessToken = await encrypt(tokens.access_token);
  const refreshToken = tokens.refresh_token
    ? await encrypt(tokens.refresh_token)
    : conn.refreshToken;
  await unwrap(
    supabaseAdmin
      .from("ConnectedAccount")
      .update({
        accessToken,
        refreshToken,
        expiresAt: newExpiresAt.toISOString(),
      })
      .eq("id", conn.id),
  );

  return tokens.access_token;
}
