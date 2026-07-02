import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import type {
  DraftItem,
  DraftsCounts,
} from "@/components/drafts/drafts-pane";

type Status =
  | "PENDING"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHED"
  | "FAILED"
  | "SKIPPED";

const FILTER_MAP: Record<keyof DraftsCounts, Status[]> = {
  pending: ["PENDING"],
  queued: ["APPROVED", "SCHEDULED"],
  shipped: ["PUBLISHED"],
  failed: ["FAILED"],
  all: ["PENDING", "APPROVED", "SCHEDULED", "PUBLISHED", "FAILED", "SKIPPED"],
};

export type DraftsData = {
  drafts: DraftItem[];
  counts: DraftsCounts;
  activeFilter: keyof DraftsCounts;
};

// Loader data for the drafts page (ported from src/app/(app)/drafts/page.tsx).
// The optional `status` search param selects the filter; anything unknown falls
// back to "pending". method: "POST" because it reads the session (cookies) via
// getCurrentUser/getCurrentProject.
export const getDraftsData = createServerFn({ method: "POST" })
  .validator((status: string | undefined) => status)
  .handler(async ({ data: status }): Promise<DraftsData> => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/sign-in" });
    const project = await getCurrentProject(user.id);

    const rawFilter = status as keyof DraftsCounts | undefined;
    const activeFilter: keyof DraftsCounts =
      rawFilter && rawFilter in FILTER_MAP ? rawFilter : "pending";
    const statuses = FILTER_MAP[activeFilter];

    const [drafts, statusGroups] = await Promise.all([
      unwrap(
        supabaseAdmin
          .from("Draft")
          .select("*, posts:Post(platform, externalUrl, error, publishedAt)")
          .eq("projectId", project.id)
          .in("status", statuses)
          .order("createdAt", { ascending: false })
          // Nested posts are ordered newest-first to match the old include order
          // (referencedTable uses the embedded alias).
          .order("publishedAt", { ascending: false, referencedTable: "posts" })
          .limit(100),
      ),
      // groupBy({ by: ['status'] }) -> the DraftStatusCount view (one row per
      // project+status with a count).
      unwrap(
        supabaseAdmin
          .from("DraftStatusCount")
          .select("status, count")
          .eq("projectId", project.id),
      ),
    ]);

    const tally: Record<Status, number> = {
      PENDING: 0,
      APPROVED: 0,
      SCHEDULED: 0,
      PUBLISHED: 0,
      FAILED: 0,
      SKIPPED: 0,
    };
    for (const g of statusGroups) {
      if (g.status) tally[g.status as Status] = g.count ?? 0;
    }

    const counts: DraftsCounts = {
      pending: tally.PENDING,
      queued: tally.APPROVED + tally.SCHEDULED,
      shipped: tally.PUBLISHED,
      failed: tally.FAILED,
      all:
        tally.PENDING +
        tally.APPROVED +
        tally.SCHEDULED +
        tally.PUBLISHED +
        tally.FAILED +
        tally.SKIPPED,
    };

    const items: DraftItem[] = drafts.map((d) => ({
      id: d.id,
      topic: d.topic,
      topics: (d.topics ?? []) as string[],
      sourceTitle: d.sourceTitle,
      sourceUrl: d.sourceUrl,
      imageUrl: d.imageUrl,
      targets: (d.targets ?? []) as ("LINKEDIN" | "TELEGRAM")[],
      status: d.status as Status,
      contentByLang: d.contentByLang as Record<string, string>,
      factVerdict: d.factVerdict,
      sourceTrust: d.sourceTrust,
      corroboratingSources: d.corroboratingSources,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      scheduledAt: d.scheduledAt,
      posts: d.posts.map((p) => ({
        platform: p.platform as "LINKEDIN" | "TELEGRAM",
        externalUrl: p.externalUrl,
        error: p.error,
        publishedAt: p.publishedAt,
      })),
    }));

    return { drafts: items, counts, activeFilter };
  });
