import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import { SettingsForm } from "@/components/forms/settings-form";
import { ConnectionsPanel } from "@/components/forms/connections-panel";
import { isNewsApiConfigured } from "@/lib/newsapi";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getCurrentProject(user.id);
  const newsApiConfigured = isNewsApiConfigured();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure topics, voice, schedule, and posting mode.
        </p>
      </div>
      <ConnectionsPanel
        projectId={project.id}
        connections={project.connectedAccounts.map((c) => ({
          id: c.id,
          platform: c.platform,
          externalId: c.externalId,
          displayName: c.displayName,
          expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
        }))}
      />
      <SettingsForm
        projectId={project.id}
        newsApiConfigured={newsApiConfigured}
        initial={{
          projectName: project.name,
          topics: project.settings?.topics ?? ["tech", "ai"],
          languages: project.settings?.languages ?? ["en"],
          writingStyle: (project.settings?.writingStyle ?? "professional") as
            | "professional"
            | "casual"
            | "technical"
            | "provocative"
            | "custom",
          customStyle: project.settings?.customStyle ?? "",
          intervalDays: project.settings?.intervalDays ?? 1,
          preferredHour: project.settings?.preferredHour ?? 9,
          timezone: project.settings?.timezone ?? "UTC",
          mode: (project.settings?.mode ?? "MANUAL") as "MANUAL" | "AUTOPILOT",
          includeHashtags: project.settings?.includeHashtags ?? true,
          includeSource: project.settings?.includeSource ?? true,
          maxPostChars: project.settings?.maxPostChars ?? 2200,
          bannedWords: project.settings?.bannedWords ?? [],
          moderationEnabled: project.settings?.moderationEnabled ?? false,
        }}
      />
    </div>
  );
}
