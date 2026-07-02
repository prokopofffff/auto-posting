import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import { computeScheduleInfo } from "@/lib/schedule";
import { relShort } from "@/lib/format";
import type { TopicRow } from "@/components/topics/topics-table";

// Loader data for the topics page (ported from src/app/(app)/topics/page.tsx).
// A server fn so the service-role Draft/Post query stays off the client bundle;
// the route calls it via the RPC bridge. method: "POST" because it resolves the
// current project from the session cookie.
export const getTopicsData = createServerFn({ method: "POST" }).handler(
  async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/sign-in" });
    const project = await getCurrentProject(user.id);
    const settings = project.settings;
    const topicNames = settings?.topics ?? [];

    // `posts:Post(id)` with an error-null filter is the nested-select form of the
    // old `posts: { where: { error: null }, select: { id } }`. createdAt comes
    // back as an ISO string and is parsed to Date below.
    const [draftsRaw, schedule] = await Promise.all([
      unwrap(
        supabaseAdmin
          .from("Draft")
          .select("topic, createdAt, posts:Post(id)")
          .eq("projectId", project.id)
          // Filter the embedded posts (by alias) to error-free ones; this trims
          // the embedded array without dropping parent drafts (no inner join).
          .is("posts.error", null),
      ),
      computeScheduleInfo(project.id),
    ]);

    const drafts = draftsRaw.map((d) => ({
      ...d,
      createdAt: new Date(d.createdAt),
    }));

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

    return {
      projectId: project.id,
      projectLanguages: settings?.languages ?? ["en"],
      rows,
      nextRunRel,
    };
  },
);
