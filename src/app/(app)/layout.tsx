import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/server/oauth-actions";
import { getCurrentProject, listUserProjects } from "@/server/project";
import { ProjectSwitcher } from "@/components/forms/project-switcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const [projects, current] = await Promise.all([
    listUserProjects(session.user.id),
    getCurrentProject(session.user.id),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <div className="grid size-7 place-items-center rounded-md bg-foreground text-background">
                AM
              </div>
              <span>Account Manager</span>
            </Link>
            <ProjectSwitcher
              projects={projects.map((p) => ({ id: p.id, name: p.name, status: p.status }))}
              currentId={current.id}
            />
            <nav className="flex items-center gap-1 text-sm">
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard">Dashboard</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/drafts">Drafts</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/analytics">Analytics</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/settings">Settings</Link>
              </Button>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {session.user.email}
            </span>
            <form action={signOutAction}>
              <Button variant="outline" size="sm">Sign out</Button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 bg-muted/40">
        <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
