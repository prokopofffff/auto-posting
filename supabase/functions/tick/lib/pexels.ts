// Stock-photo search (Pexels) — lets the generation pipeline auto-attach a
// relevant landscape photo to a draft, picked by the post's topic. Entirely
// best-effort: when PEXELS_API_KEY is unset or the call fails we return null and
// the draft stays text-only, so image search never blocks publishing.
//
// Get a free key at https://www.pexels.com/api/ and set it as a Supabase
// function secret: `supabase secrets set PEXELS_API_KEY=...`.
const PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search";

type PexelsResponse = {
  photos?: Array<{
    src?: { large?: string; landscape?: string; original?: string; medium?: string };
  }>;
};

/** Returns a hotlinkable image URL for `query`, or null if none / not configured. */
export async function searchPhoto(query: string): Promise<string | null> {
  const apiKey = Deno.env.get("PEXELS_API_KEY");
  const q = query.trim();
  if (!apiKey || !q) return null;
  try {
    const url = new URL(PEXELS_SEARCH_URL);
    url.searchParams.set("query", q);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("orientation", "landscape");
    const res = await fetch(url, { headers: { authorization: apiKey } });
    if (!res.ok) return null;
    const data = (await res.json()) as PexelsResponse;
    const src = data.photos?.[0]?.src;
    return src?.landscape ?? src?.large ?? src?.original ?? src?.medium ?? null;
  } catch {
    return null;
  }
}
