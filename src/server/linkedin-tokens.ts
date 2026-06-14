import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken, type LinkedInTokenResponse } from "@/lib/linkedin";
import type { ConnectedAccount } from "@/lib/types";

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

  // expiresAt is an ISO string from supabase-js; parse before comparing.
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
