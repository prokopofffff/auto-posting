import Parser from "rss-parser";
import { db } from "@/lib/db";
import { GLOBAL_FALLBACK_FEEDS, TOPIC_FEEDS } from "@/lib/news-feeds";
import { fetchNewsApi, isNewsApiConfigured } from "@/lib/newsapi";
import type { NewsItem } from "@/lib/news-types";

export type { NewsItem } from "@/lib/news-types";

const parser = new Parser({
  timeout: 10_000,
  headers: { "user-agent": "Mozilla/5.0 (compatible; account-manager/1.0)" },
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

async function parseFeed(url: string): Promise<NewsItem[]> {
  try {
    const feed = await parser.parseURL(url);
    const source = feed.title ?? new URL(url).hostname;
    return (feed.items ?? [])
      .map((item) => ({
        title: item.title?.trim() ?? "",
        url: item.link?.trim() ?? "",
        summary: (item.contentSnippet ?? item.content ?? item.summary ?? "").trim().slice(0, 2000),
        source,
        publishedAt: item.isoDate ? new Date(item.isoDate) : null,
      }))
      .filter((n) => n.title && n.url);
  } catch {
    return [];
  }
}

export async function fetchCandidateNews(topics: string[]): Promise<NewsItem[]> {
  const { templates, custom } = splitTopics(topics);

  const feeds = feedsForTemplates(templates);
  const usingFallback = feeds.length === 0 && custom.length === 0;
  const feedUrls = usingFallback ? GLOBAL_FALLBACK_FEEDS : feeds;

  const rssPromise = Promise.all(feedUrls.map(parseFeed)).then((r) => r.flat());
  const newsApiPromise =
    custom.length > 0 && isNewsApiConfigured()
      ? fetchNewsApi(custom, { pageSize: 20, daysBack: 7 })
      : Promise.resolve<NewsItem[]>([]);

  const [rss, api] = await Promise.all([rssPromise, newsApiPromise]);
  const merged = [...api, ...rss];

  merged.sort((a, b) => {
    const ad = a.publishedAt?.getTime() ?? 0;
    const bd = b.publishedAt?.getTime() ?? 0;
    return bd - ad;
  });

  const seen = new Set<string>();
  return merged.filter((n) => {
    if (seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
}

export async function pickFreshArticle(
  projectId: string,
  topics: string[],
): Promise<NewsItem | null> {
  const candidates = await fetchCandidateNews(topics);
  if (candidates.length === 0) return null;

  const recentPosts = await db.post.findMany({
    where: { projectId },
    orderBy: { publishedAt: "desc" },
    take: 200,
    select: { externalUrl: true, content: true },
  });
  const usedUrls = new Set(
    recentPosts.map((p) => p.externalUrl).filter((u): u is string => !!u),
  );
  const recentTitles = recentPosts
    .map((p) => p.content.split("\n")[0]?.trim().toLowerCase())
    .filter((t): t is string => !!t);

  for (const item of candidates) {
    if (usedUrls.has(item.url)) continue;
    const titleLc = item.title.toLowerCase();
    if (recentTitles.some((t) => t === titleLc)) continue;
    return item;
  }
  return candidates[0] ?? null;
}
