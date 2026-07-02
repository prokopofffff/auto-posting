import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getAppShellData } from "@/server/app-shell";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppTopbar } from "@/components/shell/app-topbar";
import {
  CommandPalette,
  GlobalShortcuts,
} from "@/components/shell/command-palette";

// Protected app shell (ported from src/app/(app)/layout.tsx). The "(app)" folder
// is a route group: this pathless layout wraps every signed-in page (dashboard,
// compose, topics, drafts, analytics, settings) without adding a URL segment.
//
// Auth is enforced by the global request middleware in src/start.ts (none of
// these paths are in PUBLIC_PATHS), so this route does not repeat the check; the
// loader's server fn simply reads the already-guaranteed session and assembles
// the sidebar/topbar/command-palette data.
export const Route = createFileRoute("/(app)")({
  loader: async () => getAppShellData(),
  component: AppLayout,
});

function AppLayout() {
  const data = Route.useLoaderData();

  return (
    <div className="app">
      <AppSidebar
        projects={data.projects}
        currentProjectId={data.currentProjectId}
        userEmail={data.userEmail}
        userInitials={data.userInitials}
        badges={{ drafts: data.pendingDraftsCount, topics: data.topicsCount }}
      />
      <main className="main">
        <AppTopbar
          projectName={data.currentProjectName}
          projectStatus={data.currentProjectStatus}
          pendingDraftsCount={data.pendingDraftsCount}
          nextRunRel={data.nextRunRel}
        />
        <div className="page">
          <Outlet />
        </div>
      </main>
      <CommandPalette
        projectId={data.currentProjectId}
        projectStatus={data.currentProjectStatus}
      />
      <GlobalShortcuts />
    </div>
  );
}
