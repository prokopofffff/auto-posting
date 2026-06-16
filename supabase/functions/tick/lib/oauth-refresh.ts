// Shared "valid OAuth access token" resolver for the edge runtime. Both the
// LinkedIn publisher (linkedin-tokens.ts) and the Claude Max resolver
// (ai-credentials.ts) store an encrypted access/refresh pair + an expiry and
// need the same dance: decrypt → if within a skew window of expiry, refresh →
// re-encrypt → persist → return the plaintext access token. This factors that
// state machine out so a fix to it lands in one place.
import { decrypt, encrypt } from "./crypto.ts";

export type RefreshedTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number; // seconds; defaults to 3600 when absent
};

// Stored credential shape: ciphertext for the tokens, ISO string for expiry.
export type EncryptedTokenRecord = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

export type GetValidTokenOptions = {
  /** Refresh this many ms before expiry. */
  skewMs: number;
  /** Exchange a plaintext refresh token for a fresh token set. */
  refresh: (plaintextRefreshToken: string) => Promise<RefreshedTokens>;
  /** Persist the re-encrypted tokens + new ISO expiry. */
  persist: (next: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string;
  }) => Promise<void>;
  /**
   * Called when a refresh is due but no refresh token is stored. Provide it to
   * hard-fail (LinkedIn: force a reconnect); omit it to fall back to the
   * current (still-within-skew) access token (Claude Max: best effort).
   */
  onMissingRefreshToken?: () => never;
};

/**
 * Returns a valid PLAINTEXT access token, refreshing + persisting first when the
 * stored one is within `skewMs` of expiry. `refresh` may throw its own typed
 * error; it propagates unchanged.
 */
export async function getValidAccessToken(
  rec: EncryptedTokenRecord,
  opts: GetValidTokenOptions,
): Promise<string> {
  const expiresMs = rec.expiresAt ? new Date(rec.expiresAt).getTime() : null;
  const needsRefresh = expiresMs !== null && expiresMs - Date.now() < opts.skewMs;
  if (!needsRefresh) return await decrypt(rec.accessToken);

  if (!rec.refreshToken) {
    if (opts.onMissingRefreshToken) opts.onMissingRefreshToken();
    return await decrypt(rec.accessToken); // best-effort current token
  }

  const tokens = await opts.refresh(await decrypt(rec.refreshToken));
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
  const accessToken = await encrypt(tokens.access_token);
  const refreshToken = tokens.refresh_token
    ? await encrypt(tokens.refresh_token)
    : rec.refreshToken;
  await opts.persist({ accessToken, refreshToken, expiresAt });
  return tokens.access_token;
}
