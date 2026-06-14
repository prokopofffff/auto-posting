// LinkedIn API surface the cron worker needs: token refresh + post creation.
// Ported from src/lib/linkedin.ts. The OAuth-connect helpers (authorize URL,
// code exchange, userinfo) and the node:crypto signed-state functions are NOT
// included here — those run only in the Netlify app's connect flow, never in the
// scheduled worker. Env is read via Deno.env.
import { TransientPublishError, parseRetryAfter } from "./retry.ts";

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const POSTS_URL = "https://api.linkedin.com/rest/posts";
const LINKEDIN_VERSION = "202404";

export type LinkedInTokenResponse = {
  access_token: string;
  expires_in: number; // seconds
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope: string;
  token_type: "Bearer";
};

async function postTokenRequest(
  op: string,
  grant: Record<string, string>,
): Promise<LinkedInTokenResponse> {
  const clientId = Deno.env.get("LINKEDIN_CLIENT_ID");
  const clientSecret = Deno.env.get("LINKEDIN_CLIENT_SECRET");
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

export function refreshAccessToken(
  refreshToken: string,
): Promise<LinkedInTokenResponse> {
  return postTokenRequest("refresh", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
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
