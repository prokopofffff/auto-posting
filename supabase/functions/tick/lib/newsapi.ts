import { decodeEntities } from "./html-entities.ts";
import type { NewsItem } from "./news-types.ts";

const API = "https://newsapi.org/v2/everything";

type NewsApiResponse = {
  status: "ok" | "error";
  totalResults?: number;
  articles?: Array<{
    source: { id: string | null; name: string };
    author: string | null;
    title: string;
    description: string | null;
    url: string;
    urlToImage: string | null;
    publishedAt: string;
    content: string | null;
  }>;
  code?: string;
  message?: string;
};

function quote(term: string): string {
  return term.includes(" ") ? `"${term}"` : term;
}

export function isNewsApiConfigured(): boolean {
  return !!Deno.env.get("NEWSAPI_KEY");
}

export async function fetchNewsApi(
  queryTerms: string[],
  opts: { language?: "en" | "ru"; pageSize?: number; daysBack?: number } = {},
): Promise<NewsItem[]> {
  const key = Deno.env.get("NEWSAPI_KEY");
  if (!key) return [];
  if (queryTerms.length === 0) return [];

  const q = queryTerms.map(quote).join(" OR ");
  const from = opts.daysBack
    ? new Date(Date.now() - opts.daysBack * 86_400_000).toISOString().slice(0, 10)
    : undefined;

  const url = new URL(API);
  url.searchParams.set("q", q);
  url.searchParams.set("sortBy", "publishedAt");
  url.searchParams.set("pageSize", String(opts.pageSize ?? 20));
  if (opts.language) url.searchParams.set("language", opts.language);
  if (from) url.searchParams.set("from", from);

  const res = await fetch(url, {
    headers: { "x-api-key": key, "user-agent": "account-manager/1.0" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as NewsApiResponse;
  if (json.status !== "ok" || !json.articles) return [];

  return json.articles
    .filter((a) => a.title && a.url)
    .map((a) => ({
      title: decodeEntities(a.title),
      url: a.url.trim(),
      summary: decodeEntities(a.description ?? a.content ?? "").slice(0, 2000),
      source: a.source.name,
      publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
    }));
}
