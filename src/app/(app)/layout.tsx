import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase/service";
import { count } from "@/lib/supabase/queries";
import { computeScheduleInfo } from "@/lib/schedule";
import { getCurrentProject, listUserProjects } from "@/server/project";
import { relShort } from "@/lib/format";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppTopbar } from "@/components/shell/app-topbar";
import { CommandPalette, GlobalShortcuts } from "@/components/shell/command-palette";

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "u";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? local[0] ?? "u";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Shares the request-cached session with the page below (one JWT verification
  // per request instead of one here + one in the page's getCurrentUser).
  const session = await auth();
  if (!session) redirect("/sign-in");
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
  const topicsCount = current.settings?.topics?.length ?? 0;

  return (
    <div className="app">
      <AppSidebar
        projects={projects.map((p) => ({ id: p.id, name: p.name, status: p.status }))}
        currentProjectId={current.id}
        userEmail={email}
        userInitials={initialsFromEmail(email)}
        badges={{ drafts: pendingDrafts, topics: topicsCount }}
      />
      <main className="main">
        <AppTopbar
          projectName={current.name}
          projectStatus={current.status}
          pendingDraftsCount={pendingDrafts}
          nextRunRel={schedule ? relShort(schedule.nextAt) : null}
        />
        <div className="page">{children}</div>
      </main>
      <CommandPalette projectId={current.id} projectStatus={current.status} />
      <GlobalShortcuts />
    </div>
  );
}
