import type { FactCheck, FactVerdict, NewsItem } from "./news-types.ts";
import {
  HIGH_TRUST,
  MIN_WITNESS_TRUST,
  publisherDomain,
  trustForDomain,
  trustForItem,
} from "./source-trust.ts";

/** A story counts as corroborated with this many distinct witness domains... */
const MIN_CORROBORATORS = 2;
/** ...or a single witness this trusted (a major wire service / outlet). */
const STRONG_WITNESS_TRUST = 0.9;

// Two headlines describe the same story when they share at least this many
// significant keywords AND clear this overlap ratio.
const SAME_STORY_MIN_SHARED = 2;
const SAME_STORY_MIN_RATIO = 0.34;

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","as","at",
  "by","from","into","over","after","before","this","that","these","those",
  "is","are","was","were","be","been","being","it","its","has","have","had",
  "will","would","could","should","can","may","new","now","says","said","amid",
  "how","why","what","when","who","you","your","his","her","they","their",
]);

/** Significant lowercase keywords from a headline, longest-first, de-duped. */
export function keywords(title: string): string[] {
  const seen = new Set<string>();
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  const out: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.sort((a, b) => b.length - a.length);
}

function keywordSet(title: string): Set<string> {
  return new Set(keywords(title));
}

/**
 * Shared keyword count and overlap-coefficient (0..1) of two keyword sets.
 * Overlap (not Jaccard) so a short headline matching a longer one still scores
 * high — different outlets phrase the same story at different lengths.
 */
function overlap(a: Set<string>, b: Set<string>): { shared: number; ratio: number } {
  if (a.size === 0 || b.size === 0) return { shared: 0, ratio: 0 };
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return { shared, ratio: shared / Math.min(a.size, b.size) };
}

function sameStory(a: Set<string>, b: Set<string>): boolean {
  const { shared, ratio } = overlap(a, b);
  return shared >= SAME_STORY_MIN_SHARED && ratio >= SAME_STORY_MIN_RATIO;
}

export function titleSimilarity(a: string, b: string): number {
  return overlap(keywordSet(a), keywordSet(b)).ratio;
}

/** Do two headlines describe the same story? */
export function describesSameStory(a: string, b: string): boolean {
  return sameStory(keywordSet(a), keywordSet(b));
}

/**
 * From a pool of candidate articles returned by a search, find the distinct
 * publisher domains (other than the origin) that report the same story.
 */
export function findCorroborators(origin: NewsItem, pool: NewsItem[]): string[] {
  const originDomain = publisherDomain(origin);
  const originKeywords = keywordSet(origin.title);
  const witnesses = new Set<string>();
  for (const r of pool) {
    if (r.url === origin.url) continue;
    const d = publisherDomain(r);
    if (!d || d === originDomain) continue;
    if (trustForDomain(d) < MIN_WITNESS_TRUST) continue;
    if (sameStory(originKeywords, keywordSet(r.title))) witnesses.add(d);
  }
  return [...witnesses];
}

export function assessVerdict(trust: number, corroborators: string[]): FactVerdict {
  if (trust >= HIGH_TRUST) return "TRUSTED";
  const strong = corroborators.some((d) => trustForDomain(d) >= STRONG_WITNESS_TRUST);
  if (strong || corroborators.length >= MIN_CORROBORATORS) return "CORROBORATED";
  return "UNVERIFIED";
}

/** Build a FactCheck for an origin item given the corroboration search pool. */
export function buildFactCheck(origin: NewsItem, pool: NewsItem[]): FactCheck {
  const trust = trustForItem(origin);
  // High-trust origins don't need (and assessVerdict ignores) corroboration.
  const corroboratingSources =
    trust >= HIGH_TRUST ? [] : findCorroborators(origin, pool);
  return {
    trust,
    verdict: assessVerdict(trust, corroboratingSources),
    corroboratingSources,
  };
}
