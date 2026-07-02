import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase/service";
import { count } from "@/lib/supabase/queries";
import { computeScheduleInfo } from "@/lib/schedule";
import { getCurrentProject, listUserProjects } from "@/server/project";
import { relShort } from "@/lib/format";

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "u";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? local[0] ?? "u";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

export type AppShellData = {
  projects: { id: string; name: string; status: "ACTIVE" | "PAUSED" }[];
  currentProjectId: string;
  currentProjectName: string;
  currentProjectStatus: "ACTIVE" | "PAUSED";
  userEmail: string;
  userInitials: string;
  pendingDraftsCount: number;
  topicsCount: number;
  // Precomputed here (server-side, matching the original layout) so loader data
  // stays JSON-serializable — `computeScheduleInfo` returns a `Date`.
  nextRunRel: string | null;
};

// Assembles everything the app shell (sidebar/topbar/command palette) needs for
// the current signed-in user, matching the data the old
// src/app/(app)/layout.tsx server component fetched inline. The redirect-when-
// signed-out behavior is handled by the global auth guard in src/start.ts; the
// belt-and-braces redirect here just narrows the `session` type for the handler.
export const getAppShellData = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppShellData> => {
    const session = await auth();
    if (!session) throw redirect({ to: "/sign-in" });
    const user = session.user;

    const [projects, current] = await Promise.all([
      listUserProjects(user.id),
      getCurrentProject(user.id),
    ]);

    const [pendingDrafts, schedule] = await Promise.all([
      count(
        supabaseAdmin
          .from("Draft")
          .select("*", { count: "exact", head: true })
          .eq("projectId", current.id)
          .eq("status", "PENDING"),
      ),
      computeScheduleInfo(current.id),
    ]);

    const email = user.email ?? "user";

    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
      })),
      currentProjectId: current.id,
      currentProjectName: current.name,
      currentProjectStatus: current.status,
      userEmail: email,
      userInitials: initialsFromEmail(email),
      pendingDraftsCount: pendingDrafts,
      topicsCount: current.settings?.topics?.length ?? 0,
      nextRunRel: schedule ? relShort(schedule.nextAt) : null,
    };
  },
);
