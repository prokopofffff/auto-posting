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
import { scoreCandidates } from "./claude.ts";
import type { ResolvedModel } from "./ai-credentials.ts";
import type { NewsItem, VerifiedArticle } from "./news-types.ts";

export type { NewsItem, VerifiedArticle } from "./news-types.ts";

/** How many fresh candidates we'll spend a corroboration check on per run. */
const MAX_VERIFY = 4;

/** How many fresh candidates we send to the relevance gate to be ranked. */
const SCORE_POOL = 12;

/** Minimum relevance score (0-100) a story needs to be eligible to post. Below
 * this the gate considers it off-topic and the run is skipped rather than
 * publishing a loosely-matched story. */
const RELEVANCE_FLOOR = 45;

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

  // Combined search: one query that ANDs all the topics together, surfacing
  // stories that sit at the intersection of the creator's interests (e.g. an
  // article about BOTH "ai" and "dev" rather than either alone). These tend to
  // be the most on-brand, so we add them to the pool; the relevance gate then
  // ranks the whole set. Only worth it with 2+ topics.
  const combinedPromise =
    topics.length >= 2
      ? searchNews({
          terms: [topics.join(" ")],
          googleQuery: "combined",
          preferNewsApi: false,
          pageSize: 20,
          daysBack: 7,
        })
      : Promise.resolve([] as NewsItem[]);

  const [rss, customNews, combined] = await Promise.all([
    rssPromise,
    customPromise,
    combinedPromise,
  ]);
  return sortByRecency(dedupeByUrl([...combined, ...customNews, ...rss]));
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

export type PickOptions = {
  /** A resolved model enables the relevance gate; omit to keep recency order. */
  resolved?: ResolvedModel;
  audience?: string | null;
  angle?: string | null;
};

type RankedCandidate = { item: NewsItem; score: number; topics: string[] };

/**
 * Order the candidate pool by fit with the creator's topics + audience + angle.
 * With a model: score each, drop anything below RELEVANCE_FLOOR, then sort
 * INTERSECTION-FIRST — a story matching more of the creator's topics wins, with
 * relevance score breaking ties. This makes "pick the story sitting at the
 * intersection of the selected topics" the default when several topics are in
 * play, while a single-topic run still just sorts by score. An empty result
 * means "nothing relevant enough — skip this run". Without a model (or if
 * scoring fails) we keep the existing recency order and apply no floor, so the
 * gate can never make generation strictly worse than before.
 */
async function rankByRelevance(
  pool: NewsItem[],
  topics: string[],
  opts: PickOptions,
): Promise<RankedCandidate[]> {
  // No model (or scoring throws below) → keep the existing recency order and
  // apply no floor, so the gate can never make generation worse than before.
  const recencyOrder = (): RankedCandidate[] =>
    pool.map((item) => ({ item, score: 0, topics: [] }));
  if (!opts.resolved) return recencyOrder();

  try {
    const scores = await scoreCandidates(
      { topics, audience: opts.audience, angle: opts.angle, candidates: pool },
      opts.resolved,
    );
    const byIndex = new Map(scores.map((s) => [s.index, s]));
    return pool
      .map((item, i) => {
        const s = byIndex.get(i);
        return { item, score: s?.score ?? 0, topics: s?.topics ?? [] };
      })
      .filter((r) => r.score >= RELEVANCE_FLOOR)
      // Widest topic intersection first; relevance score breaks ties.
      .sort((a, b) => b.topics.length - a.topics.length || b.score - a.score);
  } catch {
    return recencyOrder();
  }
}

export async function pickFreshArticle(
  projectId: string,
  topics: string[],
  opts: PickOptions = {},
): Promise<VerifiedArticle | null> {
  // The news fetch and the "what have we already reviewed" lookup are
  // independent, so run them together rather than back-to-back.
  //
  // "Already reviewed" = we've previously built a Draft for this article. The
  // Draft table is the canonical record here: it stores the real source URL +
  // headline (Post.externalUrl is the published-post link, NOT the article URL,
  // so it never matched a candidate). Deduping on Draft covers every story we've
  // turned into content — PENDING, SKIPPED, and PUBLISHED alike — so we don't
  // surface the same news twice.
  const [candidates, seenDrafts] = await Promise.all([
    fetchCandidateNews(topics),
    unwrap(
      supabaseAdmin
        .from("Draft")
        .select("sourceUrl, sourceTitle")
        .eq("projectId", projectId)
        .order("createdAt", { ascending: false })
        .limit(400),
    ),
  ]);
  if (candidates.length === 0) return null;

  const usedUrls = new Set(
    seenDrafts.map((d) => d.sourceUrl).filter((u): u is string => !!u),
  );
  const seenTitles = new Set(
    seenDrafts
      .map((d) => d.sourceTitle?.trim().toLowerCase())
      .filter((t): t is string => !!t),
  );

  const fresh = candidates.filter((item) => {
    if (usedUrls.has(item.url)) return false;
    return !seenTitles.has(item.title.trim().toLowerCase());
  });

  // Every candidate has already been drafted — nothing new to say. Skip this run
  // instead of re-posting a story we've covered; the next tick tries again once
  // fresh news appears. (This used to fall back to the full pool, which could
  // re-draft a duplicate.)
  if (fresh.length === 0) return null;

  const pool = fresh.slice(0, SCORE_POOL);
  if (pool.length === 0) return null;

  const ranked = await rankByRelevance(pool, topics, opts);
  // Gate ran and rejected everything as off-topic — skip rather than post junk.
  if (ranked.length === 0) return null;

  const slice = ranked.slice(0, MAX_VERIFY);
  const pick = (idx: number, article: VerifiedArticle): VerifiedArticle => ({
    ...article,
    // Full intersection set, most central first; matchedTopic stays the primary
    // (first) topic so single-topic consumers keep working.
    matchedTopics: slice[idx].topics,
    matchedTopic: slice[idx].topics[0] ?? null,
    relevance: slice[idx].score,
  });

  // Verify lazily, best-first: the top-ranked story is usually trusted or
  // corroborated, so check it alone before spending corroboration searches on
  // the rest. The first corroborated story is also the highest-ranked one
  // (`slice` is sorted best-first); if none corroborate, fall back to the top
  // (which then goes to a human via the UNVERIFIED confidence ceiling).
  const top = await verify(slice[0].item);
  if (top.factCheck.verdict !== "UNVERIFIED") return pick(0, top);

  const rest = await Promise.all(slice.slice(1).map((r) => verify(r.item)));
  const restIdx = rest.findIndex((c) => c.factCheck.verdict !== "UNVERIFIED");
  return restIdx >= 0 ? pick(restIdx + 1, rest[restIdx]) : pick(0, top);
}
