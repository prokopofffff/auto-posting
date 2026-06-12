import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import {
  DraftsPane,
  type DraftItem,
  type DraftsCounts,
} from "@/components/drafts/drafts-pane";

export const dynamic = "force-dynamic";

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

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getCurrentProject(user.id);
  const params = await searchParams;
  const rawFilter = params.status as keyof DraftsCounts | undefined;
  const activeFilter: keyof DraftsCounts =
    rawFilter && rawFilter in FILTER_MAP ? rawFilter : "pending";
  const statuses = FILTER_MAP[activeFilter];

  const [drafts, statusGroups] = await Promise.all([
    db.draft.findMany({
      where: { projectId: project.id, status: { in: statuses } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        posts: {
          orderBy: { publishedAt: "desc" },
          select: {
            platform: true,
            externalUrl: true,
            error: true,
            publishedAt: true,
          },
        },
      },
    }),
    db.draft.groupBy({
      by: ["status"],
      where: { projectId: project.id },
      _count: { _all: true },
    }),
  ]);

  const tally: Record<Status, number> = {
    PENDING: 0,
    APPROVED: 0,
    SCHEDULED: 0,
    PUBLISHED: 0,
    FAILED: 0,
    SKIPPED: 0,
  };
  for (const g of statusGroups) tally[g.status as Status] = g._count._all;

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
    sourceTitle: d.sourceTitle,
    sourceUrl: d.sourceUrl,
    targets: d.targets as ("LINKEDIN" | "TELEGRAM")[],
    status: d.status as Status,
    contentByLang: d.contentByLang as Record<string, string>,
    factVerdict: d.factVerdict,
    sourceTrust: d.sourceTrust,
    corroboratingSources: d.corroboratingSources,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    scheduledAt: d.scheduledAt ? d.scheduledAt.toISOString() : null,
    posts: d.posts.map((p) => ({
      platform: p.platform as "LINKEDIN" | "TELEGRAM",
      externalUrl: p.externalUrl,
      error: p.error,
      publishedAt: p.publishedAt.toISOString(),
    })),
  }));

  return (
    <DraftsPane drafts={items} counts={counts} activeFilter={activeFilter} />
  );
}
