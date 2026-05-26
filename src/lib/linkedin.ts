import { createHmac, timingSafeEqual } from "node:crypto";
import { TransientPublishError, parseRetryAfter } from "@/lib/retry";

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const POSTS_URL = "https://api.linkedin.com/rest/posts";
const LINKEDIN_VERSION = "202404";

const SCOPES = ["openid", "profile", "w_member_social"];

export type LinkedInUserInfo = {
  sub: string; // member id, e.g. "abc123"
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
};

export type LinkedInTokenResponse = {
  access_token: string;
  expires_in: number; // seconds
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope: string;
  token_type: "Bearer";
};

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) throw new Error("LINKEDIN_CLIENT_ID is not set");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES.join(" "));
  return url.toString();
}

async function postTokenRequest(
  op: string,
  grant: Record<string, string>,
): Promise<LinkedInTokenResponse> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("LinkedIn client credentials are not set");
  const body = new URLSearchParams({
    ...grant,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`LinkedIn token ${op} failed: ${res.status} ${txt}`);
  }
  return (await res.json()) as LinkedInTokenResponse;
}

export function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<LinkedInTokenResponse> {
  return postTokenRequest("exchange", {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

export function refreshAccessToken(
  refreshToken: string,
): Promise<LinkedInTokenResponse> {
  return postTokenRequest("refresh", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`LinkedIn userinfo failed: ${res.status}`);
  return (await res.json()) as LinkedInUserInfo;
}

export type LinkedInPostResult = {
  id: string; // URN of the created post
  url: string | null;
};

export async function createPost(
  accessToken: string,
  authorUrn: string,
  text: string,
): Promise<LinkedInPostResult> {
  let res: Response;
  try {
    res = await fetch(POSTS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "LinkedIn-Version": LINKEDIN_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: authorUrn,
        commentary: text,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
      cache: "no-store",
    });
  } catch (e) {
    throw new TransientPublishError(`LinkedIn post network error: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 429 || res.status >= 500) {
      throw new TransientPublishError(`LinkedIn post failed: ${res.status} ${txt}`, {
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      });
    }
    throw new Error(`LinkedIn post failed: ${res.status} ${txt}`);
  }
  const postUrn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
  const id = postUrn ?? "";
  const activityId = id.split(":").pop();
  const url = activityId ? `https://www.linkedin.com/feed/update/${id}/` : null;
  return { id, url };
}

// ---- signed state (CSRF + binds to project/user) ----

function secret(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return Buffer.from(s);
}

export function signState(payload: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string): Record<string, string> | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
