// News discovery + fact-check, ported from src/lib/news.ts for the Edge runtime.
//
// The app uses the `rss-parser` npm package (Node http/xml2js under the hood).
// Rather than drag that into Deno, this file ships a small dependency-free feed
// parser (RSS 2.0 + Atom) that extracts exactly the fields the pipeline needs:
// title, link, summary/snippet, isoDate, and the Google News <source url="...">
// publisher hint. Everything downstream (dedupe, recency sort, corroboration,
// candidate selection) is identical to the app version.
import { supabaseAdmin, unwrap } from "./supabase.ts";
import { GLOBAL_FALLBACK_FEEDS, TOPIC_FEEDS } from "./news-feeds.ts";
import { fetchNewsApi, isNewsApiConfigured } from "./newsapi.ts";
import { buildFactCheck, keywords } from "./fact-check.ts";
import { domainOf, isHighTrust } from "./source-trust.ts";
import type { NewsItem, VerifiedArticle } from "./news-types.ts";

export type { NewsItem, VerifiedArticle } from "./news-types.ts";

/** How many fresh candidates we'll spend a corroboration check on per run. */
const MAX_VERIFY = 4;

const FEED_TIMEOUT_MS = 10_000;
const USER_AGENT = "Mozilla/5.0 (compatible; account-manager/1.0)";

// --- minimal feed parsing --------------------------------------------------

type ParsedItem = {
  title: string;
  link: string;
  snippet: string;
  isoDate: string | null;
  /** Google News carries the real publisher in <source url="...">name</source>. */
  sourceName: string | null;
  sourceUrl: string | null;
};

type ParsedFeed = { title: string | null; items: ParsedItem[] };

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function firstTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

/** Atom <link href="..."/> or RSS <link>...</link>. */
function extractLink(block: string): string {
  const rss = block.match(/<link>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim()) return decodeEntities(rss[1]);
  // Atom: prefer rel="alternate", else first href.
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decodeEntities(alt[1]);
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any ? decodeEntities(any[1]) : "";
}

function extractSource(block: string): { name: string | null; url: string | null } {
  const m = block.match(/<source([^>]*)>([\s\S]*?)<\/source>/i);
  if (!m) return { name: null, url: null };
  const urlAttr = m[1].match(/url=["']([^"']+)["']/i);
  const name = decodeEntities(m[2]) || null;
  return { name: name || null, url: urlAttr ? decodeEntities(urlAttr[1]) : null };
}

function parseFeedXml(xml: string): ParsedFeed {
  const channelTitle = firstTag(xml, "title");
  const blocks = [
    ...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  const items: ParsedItem[] = blocks.map((block) => {
    const src = extractSource(block);
    const rawSummary =
      firstTag(block, "description") ??
      firstTag(block, "summary") ??
      firstTag(block, "content") ??
      "";
    return {
      title: firstTag(block, "title") ?? "",
      link: extractLink(block),
      snippet: stripTags(rawSummary),
      isoDate:
        firstTag(block, "pubDate") ??
        firstTag(block, "published") ??
        firstTag(block, "updated") ??
        firstTag(block, "dc:date"),
      sourceName: src.name,
      sourceUrl: src.url,
    };
  });
  return { title: channelTitle, items };
}

async function fetchFeedXml(url: string): Promise<ParsedFeed | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "user-agent": USER_AGENT },
        signal: ctrl.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    return parseFeedXml(await res.text());
  } catch {
    return null;
  }
}

function toIsoDate(raw: string | null): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}

// --- topic → feed plumbing (unchanged from the app) ------------------------

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
  sourceName: string | null,
  sourceUrl: string | null,
): { title: string; publisher: string | null; domain: string | null } {
  const publisher = sourceName?.trim() || null;
  const domain = domainOf(sourceUrl);
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

function toNewsItem(item: ParsedItem, fallbackSource: string): NewsItem {
  return {
    title: item.title.trim(),
    url: item.link.trim(),
    summary: item.snippet.slice(0, 2000),
    source: fallbackSource,
    publishedAt: toIsoDate(item.isoDate),
  };
}

function toGoogleNewsItem(item: ParsedItem, fallbackSource: string): NewsItem {
  const g = parseGoogleItem(item.title.trim(), item.sourceName, item.sourceUrl);
  return {
    title: g.title,
    url: item.link.trim(),
    summary: item.snippet.slice(0, 2000),
    source: g.publisher ?? fallbackSource,
    publishedAt: toIsoDate(item.isoDate),
    sourceDomain: g.domain ?? undefined,
  };
}

async function fetchFeed(
  url: string,
  mapItem: (item: ParsedItem, fallbackSource: string) => NewsItem,
): Promise<NewsItem[]> {
  const feed = await fetchFeedXml(url);
  if (!feed) return [];
  let fallbackSource = feed.title ?? "";
  if (!fallbackSource) {
    try {
      fallbackSource = new URL(url).hostname;
    } catch {
      fallbackSource = url;
    }
  }
  return feed.items
    .map((item) => mapItem(item, fallbackSource))
    .filter((n) => n.title && n.url);
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
  googleQuery: "per-term" | "combined";
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

  const top = await verify(slice[0]);
  if (top.factCheck.verdict !== "UNVERIFIED") return top;

  const rest = await Promise.all(slice.slice(1).map(verify));
  return rest.find((c) => c.factCheck.verdict !== "UNVERIFIED") ?? top;
}
