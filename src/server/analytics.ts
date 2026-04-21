import { db } from "@/lib/db";

export type AnalyticsSummary = {
  totalPublished: number;
  totalFailed: number;
  published7d: number;
  published30d: number;
  byPlatform: Array<{ platform: "TELEGRAM" | "LINKEDIN"; published: number; failed: number }>;
  byTopic: Array<{ topic: string; count: number }>;
  dailyCounts: Array<{ day: string; published: number; failed: number }>;
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

export async function getAnalytics(projectId: string): Promise<AnalyticsSummary> {
  const now = Date.now();
  const from30 = new Date(now - 30 * 86_400_000);
  const from7 = new Date(now - 7 * 86_400_000);

  const posts = await db.post.findMany({
    where: { projectId, publishedAt: { gte: from30 } },
    select: {
      platform: true,
      error: true,
      publishedAt: true,
      draft: { select: { topic: true } },
    },
  });

  const totalPublished = await db.post.count({
    where: { projectId, error: null },
  });
  const totalFailed = await db.post.count({
    where: { projectId, error: { not: null } },
  });

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

  return {
    totalPublished,
    totalFailed,
    published7d,
    published30d,
    byPlatform,
    byTopic,
    dailyCounts,
  };
}
