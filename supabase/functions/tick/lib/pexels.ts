// Stock-photo search (Pexels) — lets the generation pipeline auto-attach a
// relevant landscape photo to a draft, picked by the post's topic. Entirely
// best-effort: when PEXELS_API_KEY is unset or the call fails we return null and
// the draft stays text-only, so image search never blocks publishing.
//
// Get a free key at https://www.pexels.com/api/ and set it as a Supabase
// function secret: `supabase secrets set PEXELS_API_KEY=...`.
const PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search";
// Pexels caps per_page at 80. Pulling a pool (rather than just the top hit) lets
// us vary the pick and skip recently-used photos, so the same topic doesn't keep
// yielding the same image.
const POOL_SIZE = 80;

type PexelsSrc = { large?: string; landscape?: string; original?: string; medium?: string };
type PexelsResponse = {
  photos?: Array<{ src?: PexelsSrc }>;
};

function bestUrl(src?: PexelsSrc): string | null {
  return src?.landscape ?? src?.large ?? src?.original ?? src?.medium ?? null;
}

/**
 * Returns a hotlinkable landscape image URL for `query`, or null if none / not
 * configured. Fetches a pool of candidates and picks one at random, preferring
 * photos whose URL isn't in `exclude` (the project's recently-used images) so
 * consecutive posts on the same topic don't reuse the same stock photo.
 */
export async function searchPhoto(
  query: string,
  exclude?: Iterable<string>,
): Promise<string | null> {
  const apiKey = Deno.env.get("PEXELS_API_KEY");
  const q = query.trim();
  if (!apiKey || !q) return null;
  const used = new Set(exclude ?? []);
  try {
    const url = new URL(PEXELS_SEARCH_URL);
    url.searchParams.set("query", q);
    url.searchParams.set("per_page", String(POOL_SIZE));
    url.searchParams.set("orientation", "landscape");
    const res = await fetch(url, { headers: { authorization: apiKey } });
    if (!res.ok) return null;
    const data = (await res.json()) as PexelsResponse;
    const candidates: string[] = [];
    for (const p of data.photos ?? []) {
      const u = bestUrl(p.src);
      if (u) candidates.push(u);
    }
    if (candidates.length === 0) return null;
    // Prefer a photo we haven't used recently; fall back to the whole pool when
    // every candidate is a repeat (a repeated image still beats none).
    const fresh = candidates.filter((u) => !used.has(u));
    const pool = fresh.length > 0 ? fresh : candidates;
    return pool[Math.floor(Math.random() * pool.length)];
  } catch {
    return null;
  }
}
