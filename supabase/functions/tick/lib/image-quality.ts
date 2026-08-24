// Guards against publishing a photo that isn't a photo. Pure functions, no
// imports — cheap to unit-test (image-quality_test.ts), and runnable in both
// runtimes: src/lib/image-quality.ts and supabase/functions/tick/lib/
// image-quality.ts are kept byte-identical, the same way html-entities.ts is.
//
// Background, measured against the live Bright Data SERP on 2026-08-24: roughly
// a third of Google-Images requests come back not as search results but as a
// canned SEO-spam result set — the same pages (billionhands.com, foter.com,
// findarticles.com …) no matter what we searched for. Half of those hits point
// at one restricted Cloudinary account, which answers HTTP 200 + image/jpeg
// with a card reading "This site does not have permission to access or serve
// this content". Google indexes that card, so its own thumbnail shows the card
// too: nothing about the download looks wrong, and the pipeline used to re-host
// it and attach it to the post. These two checks are how we tell the difference.

/** Fewer hits than this and concentration says nothing — see `looksDegraded`. */
const MIN_SAMPLE = 20;
/** Junk sets ran 49–61% single-host; healthy ones peaked at 6–14%. */
const MAX_HOST_SHARE = 0.25;
/** Junk sets were 65–77% unique URLs; healthy ones were 100%. */
const MIN_UNIQUE_SHARE = 0.9;

/**
 * True when a Google-Images result set looks like the spam page rather than
 * real results, so the caller should resample instead of posting from it.
 *
 * Two tells, both far from anything a healthy set produces: most of the hits
 * come from a single host, or the set is padded with duplicate URLs. An empty
 * set counts as degraded too — a scrape that parsed to nothing is a failure
 * worth retrying, not an answer.
 *
 * Short result lists are always accepted: on a rare topic one publisher can
 * legitimately own most of the hits, and discarding those would cost us more
 * photos than the occasional bad one.
 */
export function looksDegraded(imageUrls: string[]): boolean {
  if (imageUrls.length === 0) return true;
  if (imageUrls.length < MIN_SAMPLE) return false;

  if (new Set(imageUrls).size < imageUrls.length * MIN_UNIQUE_SHARE) return true;

  const perHost = new Map<string, number>();
  for (const url of imageUrls) {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue; // unparseable — can't attribute it to a host, so skip it
    }
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
  }
  let topHost = 0;
  for (const count of perHost.values()) topHost = Math.max(topHost, count);
  return topHost > imageUrls.length * MAX_HOST_SHARE;
}

/** Lowercase hex SHA-256 of `bytes`. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Cloudinary's "This site does not have permission to access or serve this
 * content" card (1280x720 JPEG, 53672 bytes), as served on 2026-08-24 for a
 * restricted account. It's a static asset, so every restricted delivery URL
 * without a transformation returns these exact bytes.
 */
export const CLOUDINARY_RESTRICTED_CARD_SHA256 =
  "d79977a1dc131f2335102ac01af9bf255005de4e379a3dfeeb00ee898856eae5";

const KNOWN_PLACEHOLDERS = new Set([CLOUDINARY_RESTRICTED_CARD_SHA256]);

/**
 * True when the downloaded bytes are a known "you may not use this image" card
 * rather than a photo. Exact-hash matching, so it only catches placeholders
 * we've seen; a resized or re-encoded variant would slip through. It's the
 * backstop for a card that survives into an otherwise healthy result set —
 * `looksDegraded` is what removes them in bulk.
 */
export async function isKnownPlaceholderImage(bytes: Uint8Array): Promise<boolean> {
  return KNOWN_PLACEHOLDERS.has(await sha256Hex(bytes));
}
