export type NewsItem = {
  title: string;
  url: string;
  summary: string;
  source: string;
  publishedAt: Date | null;
  /**
   * Real publisher domain (e.g. "theverge.com") when known. For aggregator
   * feeds like Google News, `url` is a redirect, so the true publisher is
   * carried here for trust scoring and de-duplication.
   */
  sourceDomain?: string;
};

/**
 * Values intentionally mirror the Prisma `FactVerdict` enum so a draft can be
 * persisted without a mapping layer. This stays a plain string union (not a
 * Prisma import) to keep the pure news/fact-check modules free of generated code.
 */
export type FactVerdict =
  /** Origin source is editorially trusted on its own. */
  | "TRUSTED"
  /** Low-trust origin, but the story is reported by other independent sources. */
  | "CORROBORATED"
  /** Low-trust origin and no independent corroboration found. */
  | "UNVERIFIED";

export type FactCheck = {
  /** Trust score of the origin source, 0..1. */
  trust: number;
  verdict: FactVerdict;
  /** Distinct publisher domains (other than the origin) reporting the story. */
  corroboratingSources: string[];
};

export type VerifiedArticle = NewsItem & {
  factCheck: FactCheck;
  /** Set by the relevance gate: which configured topic this story best matches
   * (the primary/most central one, == matchedTopics[0]). */
  matchedTopic?: string | null;
  /** Set by the relevance gate: every configured topic this story relates to
   * (the intersection), most central first. */
  matchedTopics?: string[];
  /** Set by the relevance gate: 0-100 fit score for the creator's interests. */
  relevance?: number;
};
