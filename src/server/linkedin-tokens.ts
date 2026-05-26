import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken, type LinkedInTokenResponse } from "@/lib/linkedin";
import type { ConnectedAccount } from "@prisma/client";

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

  const needsRefresh =
    !!conn.expiresAt && conn.expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;

  if (!needsRefresh) {
    return decrypt(conn.accessToken);
  }

  if (!conn.refreshToken) {
    throw new LinkedInReconnectRequiredError(
      "LinkedIn token expired and no refresh token is stored — reconnect the account in Settings.",
    );
  }

  let tokens: LinkedInTokenResponse;
  try {
    tokens = await refreshAccessToken(decrypt(conn.refreshToken));
  } catch (e) {
    throw new LinkedInReconnectRequiredError(
      `LinkedIn token refresh failed — reconnect the account in Settings. (${(e as Error).message})`,
    );
  }

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await db.connectedAccount.update({
    where: { id: conn.id },
    data: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : conn.refreshToken,
      expiresAt: newExpiresAt,
    },
  });

  return tokens.access_token;
}
