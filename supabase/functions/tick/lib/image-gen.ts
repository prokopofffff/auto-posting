// AI image generation (Pollinations) — lets the generation pipeline attach a
// bespoke image that visually describes a draft, built from a prompt the model
// writes for the post (not a stock-photo lookup). Unlike stock search, every
// post gets a unique illustration tailored to its content.
//
// Pollinations needs no API key: the image URL is built from the prompt and is
// hotlinkable (the image is generated on first fetch, then CDN-cached). Best-
// effort throughout — when generation is disabled or the prompt is empty we
// return null and the draft stays text-only, so it never blocks publishing.
//
// Optional env:
//   IMAGE_GEN=off          — disable generation entirely (drafts stay text-only)
//   IMAGE_STYLE="..."      — override the shared visual style (see DEFAULT_STYLE)
//   POLLINATIONS_TOKEN=... — a secret key (sk_*) from https://enter.pollinations.ai
//                            for higher rate limits + guaranteed watermark removal
const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt/";
const MODEL = "flux";
// LinkedIn link-preview / Telegram-friendly landscape (1.91:1).
const WIDTH = 1200;
const HEIGHT = 630;

// The shared look every generated image gets, appended to the model's per-post
// prompt so all of a project's posts share one visual identity. Editorial flat
// illustration (not photography — that was the whole point) and explicitly no
// text, since image models render garbled words. Override with IMAGE_STYLE.
const DEFAULT_STYLE =
  "modern flat editorial illustration, clean vector style, bold simple shapes," +
  " confident color palette, professional, crisp, high quality, no text, no" +
  " words, no letters, no logos, no watermark";

function style(): string {
  return Deno.env.get("IMAGE_STYLE")?.trim() || DEFAULT_STYLE;
}

/** Build a hotlinkable Pollinations image URL for `prompt` at `seed`. Pure. */
export function buildImageUrl(prompt: string, seed: number): string {
  const full = `${prompt.trim()}. ${style()}`;
  const url = new URL(POLLINATIONS_BASE + encodeURIComponent(full));
  url.searchParams.set("width", String(WIDTH));
  url.searchParams.set("height", String(HEIGHT));
  url.searchParams.set("model", MODEL);
  url.searchParams.set("seed", String(seed));
  url.searchParams.set("nologo", "true");
  // Don't list our generations in the public Pollinations feed.
  url.searchParams.set("private", "true");
  // NOTE: never put POLLINATIONS_TOKEN in this URL — it's persisted on the draft
  // and handed to LinkedIn/Telegram to fetch, so a secret key would leak. The
  // token is sent only on our server-side warm() fetch, via an auth header.
  return url.toString();
}

// Ask Pollinations to render the image now, so by the time a platform fetches
// the URL it's already CDN-cached and loads fast. Best-effort with a timeout —
// if it's slow or fails the URL still generates on first real fetch.
async function warm(url: string): Promise<void> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25_000);
  // Authenticate the warm fetch (only) when a token is set: higher rate limits
  // and watermark-free rendering, without ever exposing the secret in the URL.
  const token = Deno.env.get("POLLINATIONS_TOKEN")?.trim();
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;
  try {
    await fetch(url, { signal: ctl.signal, headers });
  } catch {
    // ignore — warming is purely an optimization
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns a hotlinkable URL for an AI-generated image of `prompt`, or null when
 * generation is disabled (IMAGE_GEN=off) or the prompt is empty. A random seed
 * makes each call (e.g. a re-pick) yield a different image; the seed is baked
 * into the returned URL, so the stored URL stays stable. Pass `warm: true` to
 * pre-render the image before returning (used by the pipeline so auto-published
 * posts ship a ready image); interactive re-picks skip it since the browser
 * preview warms the cache on its own.
 */
export async function generateImage(
  prompt: string,
  opts?: { seed?: number; warm?: boolean },
): Promise<string | null> {
  if (Deno.env.get("IMAGE_GEN")?.trim().toLowerCase() === "off") return null;
  const p = prompt.trim();
  if (!p) return null;
  const seed = opts?.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const url = buildImageUrl(p, seed);
  if (opts?.warm) await warm(url);
  return url;
}
