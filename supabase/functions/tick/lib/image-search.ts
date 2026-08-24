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
import { isKnownPlaceholderImage, looksDegraded } from "./image-quality.ts";

const ENDPOINT = "https://api.brightdata.com/request";
const DEFAULT_ZONE = "autopost_images";
const BUCKET = "post-images";
// How many times to ask Bright Data for the same query before giving up. About
// a third of requests come back as an SEO-spam result set and another sixth
// aren't parseable JSON at all (measured 2026-08-24); both are per-request
// flukes that a resample clears, so three attempts land a usable set most of
// the time. Failing to [] is fine — the draft just stays text-only.
const SERP_ATTEMPTS = 3;
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

/**
 * One Google Images hit. `url` is the full-resolution image on the publisher's
 * own server; `thumbnail` is Google's own copy (gstatic URL or embedded data:
 * URI) which — unlike the original — is never hotlink-protected, so it's a safe
 * preview image and a reliable re-host fallback.
 */
export type ImageCandidate = {
  url: string;
  thumbnail?: string;
  sourcePage: string;
  source: string;
};

// The fields we read off a parsed Bright Data Google-Images result. The
// thumbnail lives under one of a few keys depending on Bright Data's parser
// version, so we read them all defensively.
type SerpImage = {
  original_image?: string;
  image?: string;
  thumbnail?: string;
  src?: string;
  link?: string;
  title?: string;
};

/** Pick a usable thumbnail (http(s) URL or data: URI) from a SERP hit, if any. */
function pickThumbnail(im: SerpImage): string | undefined {
  for (const v of [im.thumbnail, im.image, im.src]) {
    if (typeof v === "string" && (v.startsWith("http") || v.startsWith("data:"))) {
      return v;
    }
  }
  return undefined;
}

// A desktop-Chrome UA plus a Referer make our download look like an in-page
// image load, which is what defeats most hotlink protection. Without them,
// many publishers return a 200-OK "no permission to serve this content"
// placeholder image instead of the real photo — which then gets re-hosted and
// shown as the post pic.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function browserHeaders(referer: string): Record<string, string> {
  const h: Record<string, string> = {
    "user-agent": BROWSER_UA,
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  // A referer from the article's own site is what a real page load would send;
  // fall back to the image's own origin when we have no source page.
  try {
    h.referer = new URL(referer).toString();
  } catch {
    /* no usable referer — send none */
  }
  return h;
}

/** Decode a `data:` URI (Bright Data's embedded thumbnail) into image bytes. */
function decodeDataUri(uri: string): { bytes: Uint8Array; ext: string; contentType: string } | null {
  const m = uri.match(/^data:([^;,]+)[^,]*;base64,(.*)$/);
  if (!m) return null;
  const ctype = m[1].trim().toLowerCase();
  const ext = EXT_BY_TYPE[ctype];
  if (!ext) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return { bytes, ext, contentType: ctype === "image/jpg" ? "image/jpeg" : ctype };
  } catch {
    return null;
  }
}

/**
 * One Bright Data call: the parsed Google-Images result set, or null when the
 * request or the parse failed (both are worth retrying).
 *
 * We use Google's modern image-search param `udm=2`. The legacy `tbm=isch`
 * page no longer renders the layout Bright Data waits for, so it stalls ~90s
 * and returns a 502 — which is what caused text-only posts and the "Find
 * images" gateway timeouts. `num` isn't accepted for image search, so the
 * upstream page is always full-size; the caller caps the results.
 */
async function fetchSerpImages(
  token: string,
  zone: string,
  query: string,
): Promise<SerpImage[] | null> {
  const target = `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=2`;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ zone, url: target, format: "json", data_format: "parsed" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    // The /request envelope is { status_code, headers, body }; `body` is the
    // parsed SERP result as a JSON *string* (occasionally already an object,
    // and sometimes not JSON at all — hence the catch).
    const env = (await res.json()) as { body?: unknown };
    const body = typeof env.body === "string" ? JSON.parse(env.body) : env.body;
    return ((body as { images?: SerpImage[] } | null)?.images) ?? [];
  } catch {
    return null;
  }
}

/**
 * Search Google Images for `query` via Bright Data and return up to `limit`
 * distinct candidates (full-resolution image URLs + their source). Empty array
 * when credentials are unset, the query is blank, or every attempt failed.
 *
 * Bright Data hands back an SEO-spam result set instead of real results often
 * enough that taking the first response on faith is how the pipeline ended up
 * attaching a "this site does not have permission…" card to every post. So we
 * resample until a set passes `looksDegraded`, and return nothing rather than
 * publish from a set that never does.
 */
export async function searchImages(
  query: string,
  limit = 10,
  attempts = SERP_ATTEMPTS,
): Promise<ImageCandidate[]> {
  const token = Deno.env.get("BRIGHTDATA_API_TOKEN")?.trim();
  const q = query.trim();
  if (!token || !q) return [];
  const zone = Deno.env.get("BRIGHTDATA_SERP_ZONE")?.trim() || DEFAULT_ZONE;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const images = await fetchSerpImages(token, zone, q);
    if (!images) continue;
    const urls = images
      .map((im) => im.original_image)
      .filter((u): u is string => typeof u === "string" && u.startsWith("http"));
    if (looksDegraded(urls)) continue;

    // Spam sets repeat the same URL many times over; dedupe so a bad set can't
    // burn all `limit` slots on one image even if it slipped past the check.
    const seen = new Set<string>();
    const out: ImageCandidate[] = [];
    for (const im of images) {
      const u = im.original_image;
      if (typeof u !== "string" || !u.startsWith("http") || seen.has(u)) continue;
      seen.add(u);
      out.push({
        url: u,
        thumbnail: pickThumbnail(im),
        sourcePage: im.link ?? "",
        source: im.title ?? "",
      });
      if (out.length >= limit) break;
    }
    if (out.length > 0) return out;
  }
  return [];
}

/** Fetch `srcUrl` (http(s) or data:) as validated image bytes, or null. */
async function fetchImageBytes(
  srcUrl: string,
  referer: string,
): Promise<{ bytes: Uint8Array; ext: string; contentType: string } | null> {
  if (srcUrl.startsWith("data:")) return decodeDataUri(srcUrl);
  try {
    const res = await fetch(srcUrl, {
      headers: browserHeaders(referer || srcUrl),
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const ctype = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[ctype];
    if (!ext) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return { bytes, ext, contentType: ctype === "image/jpg" ? "image/jpeg" : ctype };
  } catch {
    return null;
  }
}

/**
 * Download `srcUrl` and re-host it in the public `post-images` bucket under
 * `projectId`, returning the stable public URL — or null when the fetch, type,
 * or upload fails (so the caller can try the next candidate). `referer` is the
 * article's source page; sending it (plus a browser UA) stops hotlink-protected
 * hosts from handing us a placeholder. Validates content type and size the same
 * way manual uploads are validated.
 */
export async function rehostImage(
  projectId: string,
  srcUrl: string,
  referer = "",
): Promise<string | null> {
  const fetched = await fetchImageBytes(srcUrl, referer);
  if (!fetched) return null;
  // Google indexes "you may not use this image" cards like any other picture,
  // so a result can look perfect — 200, image/jpeg, matching thumbnail — and
  // still be a refusal notice. The bytes are the only tell.
  if (await isKnownPlaceholderImage(fetched.bytes)) return null;
  const path = `${projectId}/${crypto.randomUUID()}.${fetched.ext}`;
  const up = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, fetched.bytes, { contentType: fetched.contentType, upsert: false });
  if (up.error) return null;
  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Search Google Images for `query` and re-host the first result that downloads
 * cleanly, returning its public URL. Used by the unattended pipeline, where no
 * human is present to choose. null when the search or every re-host fails.
 *
 * Two passes, in quality order: every candidate's full-resolution original
 * first, and only if none of them survive, Google's own thumbnails (never
 * hotlink-protected, but a few hundred pixels wide). Interleaving the two would
 * settle for the first hit's thumbnail while a full-size photo was still
 * available one result down.
 */
export async function searchAndRehostFirst(
  projectId: string,
  query: string,
): Promise<string | null> {
  const candidates = await searchImages(query, 8);
  for (const c of candidates) {
    const url = await rehostImage(projectId, c.url, c.sourcePage);
    if (url) return url;
  }
  for (const c of candidates) {
    if (!c.thumbnail) continue;
    const url = await rehostImage(projectId, c.thumbnail, c.sourcePage);
    if (url) return url;
  }
  return null;
}
