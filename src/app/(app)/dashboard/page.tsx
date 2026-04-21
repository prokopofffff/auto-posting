import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleProjectStatus } from "@/components/forms/toggle-project-status";
import { GenerateNowButton } from "@/components/forms/generate-now-button";
import { OnboardingCard } from "@/components/onboarding-card";
import { ExpiryBanner } from "@/components/expiry-banner";
import { computeScheduleInfo, formatRelative } from "@/lib/schedule";
import { db } from "@/lib/db";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getCurrentProject(user.id);
  const settings = project.settings;
  const schedule = await computeScheduleInfo(project.id);

  const hasAnyTopic = (settings?.topics?.length ?? 0) > 0;
  const hasConnection = project.connectedAccounts.length > 0;
  const postsCount = await db.post.count({ where: { projectId: project.id, error: null } });
  const hasPublished = postsCount > 0;
  const showOnboarding = !hasConnection || !hasPublished;

  const connectedSummary = (() => {
    if (project.connectedAccounts.length === 0) return "No accounts connected yet.";
    const tg = project.connectedAccounts.filter((c) => c.platform === "TELEGRAM").length;
    const li = project.connectedAccounts.filter((c) => c.platform === "LINKEDIN").length;
    const parts: string[] = [];
    if (tg) parts.push(`${tg} Telegram`);
    if (li) parts.push(`${li} LinkedIn`);
    return parts.join(" · ");
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            {project.status === "ACTIVE"
              ? schedule
                ? `Next run ${formatRelative(schedule.nextAt)} · ${schedule.nextAt.toLocaleString()}`
                : "Agent is running on schedule."
              : "Agent is paused. Turn it on when you're ready."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GenerateNowButton projectId={project.id} />
          <ToggleProjectStatus projectId={project.id} status={project.status} />
        </div>
      </div>

      <ExpiryBanner
        projectId={project.id}
        connections={project.connectedAccounts.map((c) => ({
          id: c.id,
          platform: c.platform,
          displayName: c.displayName,
          expiresAt: c.expiresAt,
        }))}
      />

      {showOnboarding && (
        <OnboardingCard
          steps={[
            {
              title: "Pick your topics and voice",
              body: "Choose what the agent should write about and in what tone.",
              done: hasAnyTopic,
              cta: { href: "/settings", label: "Open settings" },
            },
            {
              title: "Connect at least one account",
              body: "Hook up Telegram and/or LinkedIn so your posts have somewhere to go.",
              done: hasConnection,
              cta: { href: "/settings", label: "Connect account" },
            },
            {
              title: "Generate your first post",
              body: "Fetch a fresh article, let Claude draft it, then approve or autopilot.",
              done: hasPublished,
              cta: { href: "/drafts", label: "Go to drafts" },
            },
          ]}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Mode</CardDescription>
            <CardTitle className="text-base">
              {settings?.mode === "AUTOPILOT" ? "Autopilot" : "Manual approval"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Schedule</CardDescription>
            <CardTitle className="text-base">
              Every {settings?.intervalDays ?? 1}{" "}
              {settings?.intervalDays === 1 ? "day" : "days"} at{" "}
              {String(settings?.preferredHour ?? 9).padStart(2, "0")}:00{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {settings?.timezone ?? "UTC"}
              </span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Languages</CardDescription>
            <CardTitle className="text-base">
              {(settings?.languages ?? ["en"]).map((l) => l.toUpperCase()).join(" / ")}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Topics</CardTitle>
          <CardDescription>What your agent writes about.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(settings?.topics ?? []).map((t) => (
            <Badge key={t} variant="secondary" className="text-sm">
              {t}
            </Badge>
          ))}
          {(settings?.topics ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No topics yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connected accounts</CardTitle>
          <CardDescription>LinkedIn and Telegram connections.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{connectedSummary}</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/settings">Configure</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
