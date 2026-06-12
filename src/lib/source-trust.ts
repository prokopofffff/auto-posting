import { GLOBAL_FALLBACK_FEEDS, TOPIC_FEEDS } from "@/lib/news-feeds";
import type { NewsItem } from "@/lib/news-types";

/** Articles at or above this trust score are publishable without corroboration. */
export const HIGH_TRUST = 0.8;
/** Minimum trust for a domain to count as a corroborating witness. */
export const MIN_WITNESS_TRUST = 0.6;

// The trust ladder, highest to lowest.
const REPUTABLE_TRUST = 0.95; // wire services / major outlets
const CURATED_TRUST = 0.85; // domains behind our hand-picked feeds
const UNKNOWN_TRUST = 0.4; // a real publisher we don't recognize
const AGGREGATOR_TRUST = 0.3; // news.google.com — a redirect, not a publisher
const NO_DOMAIN_TRUST = 0.2; // couldn't even resolve a domain

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Domains of all feeds we curated by hand — editorially trusted by us. */
const CURATED_DOMAINS = new Set<string>(
  [...Object.values(TOPIC_FEEDS).flat(), ...GLOBAL_FALLBACK_FEEDS]
    .map(domainOf)
    .filter((h): h is string => !!h),
);

/** Wire services and major outlets used as high-trust corroboration witnesses. */
const REPUTABLE_DOMAINS = new Set<string>([
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "bloomberg.com",
  "wsj.com",
  "nytimes.com",
  "ft.com",
  "theguardian.com",
  "cnbc.com",
  "washingtonpost.com",
  "wired.com",
  "engadget.com",
  "zdnet.com",
  "cnet.com",
  "forbes.com",
  "axios.com",
  "theinformation.com",
  "nature.com",
  "sciencemag.org",
]);

function matchesSet(domain: string, set: Set<string>): boolean {
  if (set.has(domain)) return true;
  for (const d of set) if (domain.endsWith("." + d)) return true;
  return false;
}

/** Trust score for a bare domain, 0..1. Unknown domains get a cautious score. */
export function trustForDomain(domain: string | null): number {
  if (!domain) return NO_DOMAIN_TRUST;
  // Google News (and similar aggregators) are redirects, not a publisher.
  if (domain.endsWith("news.google.com")) return AGGREGATOR_TRUST;
  if (matchesSet(domain, REPUTABLE_DOMAINS)) return REPUTABLE_TRUST;
  if (matchesSet(domain, CURATED_DOMAINS)) return CURATED_TRUST;
  return UNKNOWN_TRUST;
}

/** Resolve the publisher domain for an item, preferring the real source. */
export function publisherDomain(item: NewsItem): string | null {
  return item.sourceDomain ?? domainOf(item.url);
}

export function trustForItem(item: NewsItem): number {
  return trustForDomain(publisherDomain(item));
}

export function isHighTrust(item: NewsItem): boolean {
  return trustForItem(item) >= HIGH_TRUST;
}
