// Valid-token resolver for LinkedIn publishing, ported from
// src/server/linkedin-tokens.ts. Refreshes an expiring token (re-encrypting the
// new credentials before persisting) and returns a usable bearer token.
import { supabaseAdmin, unwrap } from "./supabase.ts";
import { refreshAccessToken } from "./linkedin.ts";
import { getValidAccessToken } from "./oauth-refresh.ts";
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

  return await getValidAccessToken(
    { accessToken: conn.accessToken, refreshToken: conn.refreshToken, expiresAt: conn.expiresAt },
    {
      skewMs: REFRESH_BUFFER_MS,
      refresh: async (refreshToken) => {
        try {
          return await refreshAccessToken(refreshToken);
        } catch (e) {
          throw new LinkedInReconnectRequiredError(
            `LinkedIn token refresh failed — reconnect the account in Settings. (${(e as Error).message})`,
          );
        }
      },
      persist: async ({ accessToken, refreshToken, expiresAt }) => {
        await unwrap(
          supabaseAdmin
            .from("ConnectedAccount")
            .update({ accessToken, refreshToken, expiresAt })
            .eq("id", conn.id),
        );
      },
      // LinkedIn has no usable token without a refresh — force a reconnect.
      onMissingRefreshToken: () => {
        throw new LinkedInReconnectRequiredError(
          "LinkedIn token expired and no refresh token is stored — reconnect the account in Settings.",
        );
      },
    },
  );
}
