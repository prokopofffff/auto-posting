import { supabaseAdmin } from "@/lib/supabase/service";
import { count, unwrap, withDates } from "@/lib/supabase/queries";

export type AnalyticsSummary = {
  totalPublished: number;
  totalFailed: number;
  published7d: number;
  published30d: number;
  publishedPrev30d: number;
  byPlatform: Array<{ platform: "TELEGRAM" | "LINKEDIN"; published: number; failed: number }>;
  byTopic: Array<{ topic: string; count: number }>;
  dailyCounts: Array<{ day: string; published: number; failed: number }>;
  hourBuckets: number[]; // 24 entries — total posts per hour (UTC) over the window
  recentFailures: Array<{
    when: string;
    topic: string;
    platform: "LINKEDIN" | "TELEGRAM";
    reason: string;
  }>;
  spend30dUsd: number;
  tokensIn30d: number;
  tokensOut30d: number;
  spendPerPostUsd: number | null;
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

// Exact head-count of Post rows, replacing the old db.post.count(). supabase-js
// returns the tally on `count` (not `data`) for a head request, so these read it
// directly rather than via unwrap().
async function countPosts(
  projectId: string,
  kind: "published" | "failed",
): Promise<number> {
  let q = supabaseAdmin
    .from("Post")
    .select("*", { count: "exact", head: true })
    .eq("projectId", projectId);
  q = kind === "published" ? q.is("error", null) : q.not("error", "is", null);
  return count(q);
}

// Exact head-count of error-free posts in the half-open window [from, to).
async function countWindow(
  projectId: string,
  from: Date,
  to: Date,
): Promise<number> {
  return count(
    supabaseAdmin
      .from("Post")
      .select("*", { count: "exact", head: true })
      .eq("projectId", projectId)
      .is("error", null)
      .gte("publishedAt", from.toISOString())
      .lt("publishedAt", to.toISOString()),
  );
}

export async function getAnalytics(projectId: string): Promise<AnalyticsSummary> {
  const now = Date.now();
  const from30 = new Date(now - 30 * 86_400_000);
  const from7 = new Date(now - 7 * 86_400_000);
  const from60 = new Date(now - 60 * 86_400_000);

  // publishedAt comes back as an ISO string from supabase-js; `withDates`
  // normalizes it to a Date so the rest of this function (hour buckets, day
  // keys, window comparisons) is unchanged. `draft:Draft(topic)` is the
  // nested-select form of the old `draft: { select: { topic } }`.
  const [
    postRows,
    prevPosts,
    failureRowsRaw,
    spendAggRows,
    totalPublished,
    totalFailed,
  ] = await Promise.all([
    unwrap(
      supabaseAdmin
        .from("Post")
        .select("platform, error, publishedAt, draft:Draft(topic)")
        .eq("projectId", projectId)
        .gte("publishedAt", from30.toISOString()),
    ),
    countWindow(projectId, from60, from30),
    unwrap(
      supabaseAdmin
        .from("Post")
        .select("platform, error, publishedAt, draft:Draft(topic)")
        .eq("projectId", projectId)
        .not("error", "is", null)
        .gte("publishedAt", from30.toISOString())
        .order("publishedAt", { ascending: false })
        .limit(6),
    ),
    unwrap(supabaseAdmin.rpc("draft_spend_30d", { p_project_id: projectId })),
    countPosts(projectId, "published"),
    countPosts(projectId, "failed"),
  ]);

  const posts = withDates(postRows, "publishedAt");
  const failureRows = withDates(failureRowsRaw, "publishedAt");
  const spendAgg = spendAggRows[0] ?? {
    costUsd: 0,
    tokensInput: 0,
    tokensOutput: 0,
  };

  const published7d = posts.filter((p) => !p.error && p.publishedAt >= from7).length;
  const published30d = posts.filter((p) => !p.error).length;

  const platformMap = new Map<string, { published: number; failed: number }>();
  for (const p of posts) {
    const bucket = platformMap.get(p.platform) ?? { published: 0, failed: 0 };
    if (p.error) bucket.failed++;
    else bucket.published++;
    platformMap.set(p.platform, bucket);
  }
  const byPlatform: AnalyticsSummary["byPlatform"] = ["LINKEDIN", "TELEGRAM"].map((platform) => ({
    platform: platform as "LINKEDIN" | "TELEGRAM",
    published: platformMap.get(platform)?.published ?? 0,
    failed: platformMap.get(platform)?.failed ?? 0,
  }));

  const topicMap = new Map<string, number>();
  for (const p of posts) {
    if (p.error || !p.draft?.topic) continue;
    topicMap.set(p.draft.topic, (topicMap.get(p.draft.topic) ?? 0) + 1);
  }
  const byTopic: AnalyticsSummary["byTopic"] = [...topicMap.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const dailyMap = new Map<string, { published: number; failed: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    dailyMap.set(dayKey(d), { published: 0, failed: 0 });
  }
  for (const p of posts) {
    const key = dayKey(p.publishedAt);
    const bucket = dailyMap.get(key);
    if (!bucket) continue;
    if (p.error) bucket.failed++;
    else bucket.published++;
  }
  const dailyCounts: AnalyticsSummary["dailyCounts"] = [...dailyMap.entries()].map(
    ([day, v]) => ({ day, published: v.published, failed: v.failed }),
  );

  const hourBuckets = Array(24).fill(0) as number[];
  for (const p of posts) {
    if (p.error) continue;
    const h = p.publishedAt.getUTCHours();
    hourBuckets[h] += 1;
  }

  const recentFailures: AnalyticsSummary["recentFailures"] = failureRows.map((p) => ({
    when: p.publishedAt.toISOString(),
    topic: p.draft?.topic ?? "—",
    platform: p.platform as "LINKEDIN" | "TELEGRAM",
    reason: p.error ?? "unknown",
  }));

  const spend30dUsd = spendAgg.costUsd ?? 0;
  const tokensIn30d = spendAgg.tokensInput ?? 0;
  const tokensOut30d = spendAgg.tokensOutput ?? 0;
  const spendPerPostUsd =
    published30d > 0 ? spend30dUsd / published30d : null;

  return {
    totalPublished,
    totalFailed,
    published7d,
    published30d,
    publishedPrev30d: prevPosts,
    byPlatform,
    byTopic,
    dailyCounts,
    hourBuckets,
    recentFailures,
    spend30dUsd,
    tokensIn30d,
    tokensOut30d,
    spendPerPostUsd,
  };
}
