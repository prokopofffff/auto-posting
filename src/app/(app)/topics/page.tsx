import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import { computeScheduleInfo } from "@/lib/schedule";
import { relShort } from "@/lib/format";
import { TopicsTable, type TopicRow } from "@/components/topics/topics-table";

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const sp = await searchParams;
  const project = await getCurrentProject(user.id);
  const settings = project.settings;
  const topicNames = settings?.topics ?? [];

  const [drafts, schedule] = await Promise.all([
    db.draft.findMany({
      where: { projectId: project.id },
      select: {
        topic: true,
        createdAt: true,
        posts: { where: { error: null }, select: { id: true } },
      },
    }),
    computeScheduleInfo(project.id),
  ]);

  const sevenDaysAgo = Date.now() - 7 * 86_400_000;
  const byTopic = new Map<
    string,
    { posts: number; lastDraftAt: Date | null; hasDraftIn7d: boolean }
  >();
  for (const d of drafts) {
    const slot = byTopic.get(d.topic) ?? {
      posts: 0,
      lastDraftAt: null,
      hasDraftIn7d: false,
    };
    slot.posts += d.posts.length;
    if (!slot.lastDraftAt || d.createdAt > slot.lastDraftAt) {
      slot.lastDraftAt = d.createdAt;
    }
    if (d.createdAt.getTime() >= sevenDaysAgo) slot.hasDraftIn7d = true;
    byTopic.set(d.topic, slot);
  }

  const rows: TopicRow[] = topicNames.map((name) => {
    const slot = byTopic.get(name);
    let status: TopicRow["status"] = "idle";
    if (slot) {
      if (slot.posts > 0 && slot.hasDraftIn7d) status = "ok";
      else if (slot.posts === 0) status = "warn";
      else status = "ok";
    }
    return {
      name,
      posts: slot?.posts ?? 0,
      lastDraftAt: slot?.lastDraftAt?.toISOString() ?? null,
      status,
    };
  });

  const nextRunRel =
    schedule && project.status === "ACTIVE" ? relShort(schedule.nextAt) : null;

  return (
    <TopicsTable
      projectId={project.id}
      projectLanguages={settings?.languages ?? ["en"]}
      initialRows={rows}
      nextRunRel={nextRunRel}
      autoOpenImport={sp.import === "1"}
    />
  );
}
