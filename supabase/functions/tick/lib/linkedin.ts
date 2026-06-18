// LinkedIn API surface the cron worker needs: token refresh + post creation.
// Ported from src/lib/linkedin.ts. The OAuth-connect helpers (authorize URL,
// code exchange, userinfo) and the node:crypto signed-state functions are NOT
// included here — those run only in the Netlify app's connect flow, never in the
// scheduled worker. Env is read via Deno.env.
import { TransientPublishError, parseRetryAfter } from "./retry.ts";

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const POSTS_URL = "https://api.linkedin.com/rest/posts";
const IMAGES_URL = "https://api.linkedin.com/rest/images";
const LINKEDIN_VERSION = "202605";

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

/**
 * Upload an image to LinkedIn and return its `urn:li:image:...` URN, ready to
 * attach to a post. Per LinkedIn's REST Images API: initialize an upload (which
 * hands back a one-time uploadUrl + the image URN) and fetch the source bytes —
 * these two are independent, so we run them concurrently — then PUT the bytes
 * to that URL. Network failures surface as transient. Callers should wrap this
 * in their own retry SEPARATELY from createPost, so a failed post doesn't
 * re-upload (and orphan) the image.
 */
export async function uploadImage(
  accessToken: string,
  ownerUrn: string,
  imageUrl: string,
): Promise<string> {
  const bytesP = (async () => {
    try {
      const imgRes = await fetch(imageUrl, { cache: "no-store" });
      if (!imgRes.ok) throw new Error(`fetch image failed: ${imgRes.status}`);
      return await imgRes.arrayBuffer();
    } catch (e) {
      throw new TransientPublishError(`Could not fetch image to upload: ${(e as Error).message}`);
    }
  })();
  const initP = (async () => {
    const initRes = await fetch(`${IMAGES_URL}?action=initializeUpload`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "LinkedIn-Version": LINKEDIN_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
      cache: "no-store",
    });
    if (!initRes.ok) {
      const txt = await initRes.text();
      throw new Error(`LinkedIn image init failed: ${initRes.status} ${txt}`);
    }
    const init = (await initRes.json()) as { value?: { uploadUrl?: string; image?: string } };
    if (!init.value?.uploadUrl || !init.value?.image) {
      throw new Error("LinkedIn image init returned no upload URL.");
    }
    return { uploadUrl: init.value.uploadUrl, imageUrn: init.value.image };
  })();

  const [bytes, init] = await Promise.all([bytesP, initP]);

  const put = await fetch(init.uploadUrl, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}` },
    body: bytes,
    cache: "no-store",
  });
  if (!put.ok) {
    if (put.status === 429 || put.status >= 500) {
      throw new TransientPublishError(`LinkedIn image upload failed: ${put.status}`, {
        status: put.status,
      });
    }
    throw new Error(`LinkedIn image upload failed: ${put.status}`);
  }
  return init.imageUrn;
}

export async function createPost(
  accessToken: string,
  authorUrn: string,
  text: string,
  // An already-uploaded `urn:li:image:...` (see uploadImage). Kept separate from
  // the upload so the caller can retry the post without re-uploading the image.
  imageUrn?: string | null,
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
        ...(imageUrn ? { content: { media: { id: imageUrn } } } : {}),
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
