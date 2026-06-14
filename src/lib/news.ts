import Parser from "rss-parser";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { GLOBAL_FALLBACK_FEEDS, TOPIC_FEEDS } from "@/lib/news-feeds";
import { fetchNewsApi, isNewsApiConfigured } from "@/lib/newsapi";
import { buildFactCheck, keywords } from "@/lib/fact-check";
import { domainOf, isHighTrust } from "@/lib/source-trust";
import type { NewsItem, VerifiedArticle } from "@/lib/news-types";

export type { NewsItem, VerifiedArticle } from "@/lib/news-types";

/** How many fresh candidates we'll spend a corroboration check on per run. */
const MAX_VERIFY = 4;

// Google News encodes the publisher in a <source url="..."> element. Pull it
// out so we can score the real publisher instead of the news.google.com redirect.
type GoogleSource = string | { _?: string; $?: { url?: string } };
const parser: Parser<unknown, { sourceTag?: GoogleSource }> = new Parser({
  timeout: 10_000,
  headers: { "user-agent": "Mozilla/5.0 (compatible; account-manager/1.0)" },
  customFields: { item: [["source", "sourceTag"]] },
});

function splitTopics(topics: string[]): { templates: string[]; custom: string[] } {
  const templates: string[] = [];
  const custom: string[] = [];
  for (const t of topics) {
    if (TOPIC_FEEDS[t]) templates.push(t);
    else custom.push(t);
  }
  return { templates, custom };
}

function feedsForTemplates(templates: string[]): string[] {
  const urls = new Set<string>();
  for (const t of templates) {
    const feeds = TOPIC_FEEDS[t];
    if (feeds) feeds.forEach((f) => urls.add(f));
  }
  return [...urls];
}

/** Google News search-RSS endpoint — keyword search over many publishers, no key. */
function googleNewsSearchUrl(query: string, lang = "en-US", country = "US"): string {
  const u = new URL("https://news.google.com/rss/search");
  u.searchParams.set("q", query);
  u.searchParams.set("hl", lang);
  u.searchParams.set("gl", country);
  u.searchParams.set("ceid", `${country}:${lang.split("-")[0]}`);
  return u.toString();
}

/** Google News titles look like "Headline - Publisher"; recover both parts. */
function parseGoogleItem(
  title: string,
  source: GoogleSource | undefined,
): { title: string; publisher: string | null; domain: string | null } {
  let publisher: string | null = null;
  let domain: string | null = null;
  if (typeof source === "string") {
    publisher = source.trim() || null;
  } else if (source && typeof source === "object") {
    publisher = source._?.trim() || null;
    domain = domainOf(source.$?.url);
  }
  // Google News formats titles as "Headline - Publisher". Strip that suffix.
  // Prefer an exact match against the known publisher; otherwise only treat a
  // trailing " - X" as the suffix when it sits in the back half of the title,
  // so a hyphen that's part of the headline itself isn't chopped off.
  const exactSuffix = publisher ? ` - ${publisher}` : null;
  if (exactSuffix && title.endsWith(exactSuffix)) {
    return { title: title.slice(0, -exactSuffix.length).trim(), publisher, domain };
  }
  const dash = title.lastIndexOf(" - ");
  if (dash > title.length / 2) {
    return {
      title: title.slice(0, dash).trim(),
      publisher: publisher ?? (title.slice(dash + 3).trim() || null),
      domain,
    };
  }
  return { title, publisher, domain };
}

type RawItem = Parser.Item & { sourceTag?: GoogleSource };

function toNewsItem(item: RawItem, fallbackSource: string): NewsItem {
  return {
    title: item.title?.trim() ?? "",
    url: item.link?.trim() ?? "",
    summary: (item.contentSnippet ?? item.content ?? item.summary ?? "").trim().slice(0, 2000),
    source: fallbackSource,
    publishedAt: item.isoDate ? new Date(item.isoDate) : null,
  };
}

function toGoogleNewsItem(item: RawItem, fallbackSource: string): NewsItem {
  const g = parseGoogleItem(item.title?.trim() ?? "", item.sourceTag);
  return {
    title: g.title,
    url: item.link?.trim() ?? "",
    summary: (item.contentSnippet ?? item.content ?? "").trim().slice(0, 2000),
    source: g.publisher ?? fallbackSource,
    publishedAt: item.isoDate ? new Date(item.isoDate) : null,
    sourceDomain: g.domain ?? undefined,
  };
}

async function fetchFeed(
  url: string,
  mapItem: (item: RawItem, fallbackSource: string) => NewsItem,
): Promise<NewsItem[]> {
  try {
    const feed = await parser.parseURL(url);
    const fallbackSource = feed.title ?? new URL(url).hostname;
    return (feed.items ?? [])
      .map((item) => mapItem(item, fallbackSource))
      .filter((n) => n.title && n.url);
  } catch {
    return [];
  }
}

const parseFeed = (url: string) => fetchFeed(url, toNewsItem);
const parseGoogleFeed = (url: string) => fetchFeed(url, toGoogleNewsItem);

function dedupeByUrl(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((n) => {
    if (!n.url || seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
}

function sortByRecency(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => {
    const ad = a.publishedAt?.getTime() ?? 0;
    const bd = b.publishedAt?.getTime() ?? 0;
    return bd - ad;
  });
}

type NewsSearch = {
  terms: string[];
  /**
   * "per-term": one Google feed per term (topic discovery, each topic covered).
   * "combined": all terms in a single query (story corroboration, all must hit).
   */
  googleQuery: "per-term" | "combined";
  /**
   * true  → a NewsAPI key replaces the Google sweep (cleaner data for discovery).
   * false → NewsAPI augments Google (maximize independent witnesses).
   */
  preferNewsApi: boolean;
  pageSize: number;
  daysBack: number;
};

/** Search news across the available providers per the given selection policy. */
async function searchNews(s: NewsSearch): Promise<NewsItem[]> {
  if (s.terms.length === 0) return [];
  const keyed = isNewsApiConfigured();
  const newsApi = () =>
    fetchNewsApi(s.terms, { pageSize: s.pageSize, daysBack: s.daysBack });

  if (s.preferNewsApi && keyed) return newsApi();

  const queries = s.googleQuery === "combined" ? [s.terms.join(" ")] : s.terms;
  const google = Promise.all(
    queries.map((q) => parseGoogleFeed(googleNewsSearchUrl(q))),
  ).then((r) => r.flat());

  if (!keyed) return dedupeByUrl(await google);
  const [g, api] = await Promise.all([google, newsApi()]);
  return dedupeByUrl([...g, ...api]);
}

export async function fetchCandidateNews(topics: string[]): Promise<NewsItem[]> {
  const { templates, custom } = splitTopics(topics);

  const feeds = feedsForTemplates(templates);
  const usingFallback = feeds.length === 0 && custom.length === 0;
  const feedUrls = usingFallback ? GLOBAL_FALLBACK_FEEDS : feeds;

  const rssPromise = Promise.all(feedUrls.map(parseFeed)).then((r) => r.flat());
  // Custom topics have no curated feed — prefer NewsAPI, fall back to Google News.
  const customPromise = searchNews({
    terms: custom,
    googleQuery: "per-term",
    preferNewsApi: true,
    pageSize: 20,
    daysBack: 7,
  });

  const [rss, customNews] = await Promise.all([rssPromise, customPromise]);
  return sortByRecency(dedupeByUrl([...customNews, ...rss]));
}

/**
 * Cross-check a story against other publishers. Used when the origin source
 * has a low trust factor — we look for independent reports of the same story.
 */
function corroborationPool(item: NewsItem): Promise<NewsItem[]> {
  return searchNews({
    terms: keywords(item.title).slice(0, 6),
    googleQuery: "combined",
    preferNewsApi: false,
    pageSize: 20,
    daysBack: 14,
  });
}

async function verify(item: NewsItem): Promise<VerifiedArticle> {
  // High-trust origins don't need a cross-check.
  if (isHighTrust(item)) {
    return { ...item, factCheck: buildFactCheck(item, []) };
  }
  const pool = await corroborationPool(item);
  return { ...item, factCheck: buildFactCheck(item, pool) };
}

export async function pickFreshArticle(
  projectId: string,
  topics: string[],
): Promise<VerifiedArticle | null> {
  const candidates = await fetchCandidateNews(topics);
  if (candidates.length === 0) return null;

  const recentPosts = await unwrap(
    supabaseAdmin
      .from("Post")
      .select("externalUrl, content")
      .eq("projectId", projectId)
      .order("publishedAt", { ascending: false })
      .limit(200),
  );
  const usedUrls = new Set(
    recentPosts.map((p) => p.externalUrl).filter((u): u is string => !!u),
  );
  const recentTitles = recentPosts
    .map((p) => p.content.split("\n")[0]?.trim().toLowerCase())
    .filter((t): t is string => !!t);

  const fresh = candidates.filter((item) => {
    if (usedUrls.has(item.url)) return false;
    const titleLc = item.title.toLowerCase();
    return !recentTitles.some((t) => t === titleLc);
  });

  const slice = (fresh.length > 0 ? fresh : candidates).slice(0, MAX_VERIFY);
  if (slice.length === 0) return null;

  // Verify the top candidate first: the common case clears here with a single
  // check and no wasted fetches. Only if it's unverified do we fan the rest out
  // in parallel, preferring the first (most recent) that clears verification.
  // Fall back to the top unverified one so we never silently produce nothing.
  const top = await verify(slice[0]);
  if (top.factCheck.verdict !== "UNVERIFIED") return top;

  const rest = await Promise.all(slice.slice(1).map(verify));
  return rest.find((c) => c.factCheck.verdict !== "UNVERIFIED") ?? top;
}
