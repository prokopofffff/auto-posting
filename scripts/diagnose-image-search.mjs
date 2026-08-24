// Diagnostic for the "placeholder instead of a photo" bug. Reproduces exactly
// what the tick Edge Function does (supabase/functions/tick/lib/image-search.ts):
// search Google Images via Bright Data, then download each candidate with the
// browser UA + Referer we send in production — but instead of re-hosting, it
// prints what came back so we can see WHERE a hotlink placeholder gets in.
//
// Usage:
//   BRIGHTDATA_API_TOKEN=... [BRIGHTDATA_SERP_ZONE=...] \
//     node scripts/diagnose-image-search.mjs "your topic" ["another topic"]
//
// Read the output: identical `sha256` across different queries means every post
// is getting the SAME placeholder image, and the `host` column names who serves it.
import { createHash } from "node:crypto";

const ENDPOINT = "https://api.brightdata.com/request";
const DEFAULT_ZONE = "autopost_images";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const token = process.env.BRIGHTDATA_API_TOKEN?.trim();
const zone = process.env.BRIGHTDATA_SERP_ZONE?.trim() || DEFAULT_ZONE;
if (!token) {
  console.error("Set BRIGHTDATA_API_TOKEN (same value as the Supabase function secret).");
  process.exit(1);
}
const queries = process.argv.slice(2);
if (queries.length === 0) {
  console.error('Pass at least one query, e.g. node scripts/diagnose-image-search.mjs "ai regulation"');
  process.exit(1);
}

/** Same request the edge function makes: parsed Google Images SERP via udm=2. */
async function searchImages(query, limit = 8) {
  const target = `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=2`;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ zone, url: target, format: "json", data_format: "parsed" }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    console.log(`  ! Bright Data returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const env = await res.json();
  const body = typeof env.body === "string" ? JSON.parse(env.body) : env.body;
  const images = body?.images ?? [];
  if (images.length > 0) {
    // The parser's field names drift between versions — show the real shape once
    // so we can tell whether `original_image` is even the publisher's URL.
    console.log(`  raw keys on first hit: ${Object.keys(images[0]).join(", ")}`);
  }
  const out = [];
  for (const im of images) {
    if (typeof im.original_image === "string" && im.original_image.startsWith("http")) {
      out.push({
        url: im.original_image,
        thumbnail: [im.thumbnail, im.image, im.src].find(
          (v) => typeof v === "string" && (v.startsWith("http") || v.startsWith("data:")),
        ),
        sourcePage: im.link ?? "",
      });
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Dimensions from the raw bytes — a placeholder is often a giveaway size. */
function dimensions(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15, skipping the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return `${buf.readUInt16BE(i + 7)}x${buf.readUInt16BE(i + 5)}`;
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return "?";
}

/** Download with production headers and report, without re-hosting anything. */
async function probe(label, srcUrl, referer) {
  if (srcUrl.startsWith("data:")) {
    console.log(`    ${label}: data: URI (${srcUrl.length} chars)`);
    return;
  }
  const host = (() => { try { return new URL(srcUrl).host; } catch { return "?"; } })();
  try {
    const res = await fetch(srcUrl, {
      headers: {
        "user-agent": BROWSER_UA,
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(referer ? { referer } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const ctype = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok) {
      console.log(`    ${label}: HTTP ${res.status} ${ctype} host=${host} -> REJECTED (we'd try the next one)`);
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const finalHost = (() => { try { return new URL(res.url).host; } catch { return host; } })();
    console.log(
      `    ${label}: HTTP ${res.status} ${ctype} ${buf.length}B ${dimensions(buf)} ` +
        `host=${host}${finalHost === host ? "" : ` -> ${finalHost}`} sha256=${sha} <- THIS is what we re-host`,
    );
  } catch (err) {
    console.log(`    ${label}: fetch failed (${err.name}) host=${host}`);
  }
}

for (const query of queries) {
  console.log(`\n=== query: ${query}`);
  const candidates = await searchImages(query);
  console.log(`  ${candidates.length} candidates with an original_image URL`);
  for (const [i, c] of candidates.entries()) {
    console.log(`  [${i}] sourcePage=${c.sourcePage || "(none)"}`);
    await probe("original ", c.url, c.sourcePage);
    // The pipeline only reaches the thumbnail when the original is rejected;
    // we probe both so we can see whether the fallback is healthy.
    if (c.thumbnail) await probe("thumbnail", c.thumbnail, c.sourcePage);
  }
}
