import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { computeScheduleInfo } from "@/lib/schedule";
import { supabaseAdmin } from "@/lib/supabase/service";
import { count, unwrap, withDates } from "@/lib/supabase/queries";

const DAY_MS = 86_400_000;

// The entire Promise.all data-fetching block from the old
// src/app/(app)/dashboard/page.tsx (a Next server component) moves here so the
// dashboard route loader can call it. The loader resolves the current user +
// project (same as the sibling (app) routes) and passes project.id in; this fn
// runs the seven parallel metric queries and returns them.
//
// supabase-js returns timestamp columns as ISO strings; each query maps them
// back to Date at the boundary via withDates, then the fn re-serializes to ISO
// strings so the loader return stays JSON-serializable. The dashboard component
// re-hydrates those strings to Date before running the (unchanged) bucketing /
// sparkline / timeline logic.
//
// Calling convention from the loader: `await getDashboardData({ data: { projectId } })`.
export const getDashboardData = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: z.string() }))
  .handler(async ({ data: { projectId } }) => {
    const now = new Date();
    const since7d = new Date(now.getTime() - 7 * DAY_MS);
    const since14d = new Date(now.getTime() - 14 * DAY_MS);

    const [
      posts7dRaw,
      postsPrev7dCount,
      drafts7dRaw,
      recentPostsRaw,
      recentDraftsRaw,
      totalPostsCount,
      schedule,
    ] = await Promise.all([
      unwrap(
        supabaseAdmin
          .from("Post")
          .select("publishedAt, error")
          .eq("projectId", projectId)
          .gte("publishedAt", since7d.toISOString()),
      ),
      count(
        supabaseAdmin
          .from("Post")
          .select("*", { count: "exact", head: true })
          .eq("projectId", projectId)
          .is("error", null)
          .gte("publishedAt", since14d.toISOString())
          .lt("publishedAt", since7d.toISOString()),
      ),
      unwrap(
        supabaseAdmin
          .from("Draft")
          .select("createdAt, topic")
          .eq("projectId", projectId)
          .gte("createdAt", since7d.toISOString()),
      ),
      unwrap(
        supabaseAdmin
          .from("Post")
          .select("id, platform, language, content, publishedAt, error")
          .eq("projectId", projectId)
          .order("publishedAt", { ascending: false })
          .limit(5),
      ),
      unwrap(
        supabaseAdmin
          .from("Draft")
          .select("id, topic, createdAt")
          .eq("projectId", projectId)
          .order("createdAt", { ascending: false })
          .limit(5),
      ),
      count(
        supabaseAdmin
          .from("Post")
          .select("*", { count: "exact", head: true })
          .eq("projectId", projectId)
          .is("error", null),
      ),
      computeScheduleInfo(projectId),
    ]);

    const posts7d = withDates(posts7dRaw, "publishedAt");
    const drafts7d = withDates(drafts7dRaw, "createdAt");
    const recentPosts = withDates(recentPostsRaw, "publishedAt");
    const recentDrafts = withDates(recentDraftsRaw, "createdAt");

    return {
      now: now.toISOString(),
      posts7d: posts7d.map((p) => ({
        publishedAt: p.publishedAt.toISOString(),
        error: p.error,
      })),
      postsPrev7d: postsPrev7dCount,
      drafts7d: drafts7d.map((d) => ({
        createdAt: d.createdAt.toISOString(),
        topic: d.topic,
      })),
      recentPosts: recentPosts.map((p) => ({
        id: p.id,
        platform: p.platform,
        language: p.language,
        content: p.content,
        publishedAt: p.publishedAt.toISOString(),
        error: p.error,
      })),
      recentDrafts: recentDrafts.map((d) => ({
        id: d.id,
        topic: d.topic,
        createdAt: d.createdAt.toISOString(),
      })),
      totalPostsCount,
      schedule: schedule ? { nextAt: schedule.nextAt.toISOString() } : null,
    };
  });
