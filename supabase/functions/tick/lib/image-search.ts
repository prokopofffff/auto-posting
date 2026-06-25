// Web image search (Bright Data SERP API → Google Images) + re-hosting. The
// pipeline searches Google Images for the post's topic, downloads a result, and
// re-hosts it in our own `post-images` bucket so the published link is stable —
// Google's image hosts frequently block hotlinking, so we never link them
// directly. Best-effort throughout: any failure returns null/[] and the draft
// stays text-only, so image search never blocks publishing.
//
// Requires Bright Data credentials as Supabase function secrets:
//   BRIGHTDATA_API_TOKEN — API key for the SERP zone
//   BRIGHTDATA_SERP_ZONE — SERP zone name (default "autopost_images")
//
// NOTE: Google Images returns arbitrary third-party images; ensuring the project
// has the right to reuse a given result is the operator's responsibility.
import { supabaseAdmin } from "./supabase.ts";

const ENDPOINT = "https://api.brightdata.com/request";
const DEFAULT_ZONE = "autopost_images";
const BUCKET = "post-images";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB, mirrors the manual-upload cap
// Content types we'll re-host, and the extension to store them under. Mirrors
// the manual-upload allowlist; `image/jpg` is a common non-standard alias.
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** One Google Images hit: the image plus where it came from (for display). */
export type ImageCandidate = { url: string; sourcePage: string; source: string };

// The fields we read off a parsed Bright Data Google-Images result.
type SerpImage = { original_image?: string; link?: string; title?: string };

/**
 * Search Google Images for `query` via Bright Data and return up to `limit`
 * candidates (full-resolution image URLs + their source). Empty array when
 * credentials are unset, the query is blank, or the request fails. Bright Data
 * rejects Google's `num` parameter for image search, so the upstream page is
 * always full-size; we cap the result here with `limit` (default 10) — that's
 * what controls how many the editor loads.
 */
export async function searchImages(query: string, limit = 10): Promise<ImageCandidate[]> {
  const token = Deno.env.get("BRIGHTDATA_API_TOKEN")?.trim();
  const q = query.trim();
  if (!token || !q) return [];
  const zone = Deno.env.get("BRIGHTDATA_SERP_ZONE")?.trim() || DEFAULT_ZONE;
  const target = `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=isch`;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ zone, url: target, format: "json", data_format: "parsed" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return [];
    // The /request envelope is { status_code, headers, body }; `body` is the
    // parsed SERP result as a JSON *string* (occasionally already an object).
    const env = (await res.json()) as { body?: unknown };
    const body = typeof env.body === "string" ? JSON.parse(env.body) : env.body;
    const images = ((body as { images?: SerpImage[] } | null)?.images) ?? [];
    const out: ImageCandidate[] = [];
    for (const im of images) {
      const u = im.original_image;
      if (typeof u === "string" && u.startsWith("http")) {
        out.push({ url: u, sourcePage: im.link ?? "", source: im.title ?? "" });
      }
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Download `srcUrl` and re-host it in the public `post-images` bucket under
 * `projectId`, returning the stable public URL — or null when the fetch, type,
 * or upload fails (so the caller can try the next candidate). Validates the
 * content type and size the same way manual uploads are validated.
 */
export async function rehostImage(projectId: string, srcUrl: string): Promise<string | null> {
  try {
    const res = await fetch(srcUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const ctype = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[ctype];
    if (!ext) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    const path = `${projectId}/${crypto.randomUUID()}.${ext}`;
    const contentType = ctype === "image/jpg" ? "image/jpeg" : ctype;
    const up = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (up.error) return null;
    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}

/**
 * Search Google Images for `query` and re-host the first result that downloads
 * cleanly, returning its public URL. Used by the unattended pipeline, where no
 * human is present to choose. null when the search or every re-host fails.
 */
export async function searchAndRehostFirst(
  projectId: string,
  query: string,
): Promise<string | null> {
  const candidates = await searchImages(query, 8);
  for (const c of candidates) {
    const url = await rehostImage(projectId, c.url);
    if (url) return url;
  }
  return null;
}
