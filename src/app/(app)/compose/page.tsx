import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import { ComposeForm, type ComposeChannel } from "@/components/compose/compose-form";

export default async function ComposePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getCurrentProject(user.id);
  const settings = project.settings;

  const byPlatform: Record<"LINKEDIN" | "TELEGRAM", typeof project.connectedAccounts> = {
    LINKEDIN: project.connectedAccounts.filter((c) => c.platform === "LINKEDIN"),
    TELEGRAM: project.connectedAccounts.filter((c) => c.platform === "TELEGRAM"),
  };

  const channels: ComposeChannel[] = [];
  if (byPlatform.LINKEDIN.length > 0) {
    const first = byPlatform.LINKEDIN[0];
    channels.push({
      platform: "LINKEDIN",
      name:
        byPlatform.LINKEDIN.length > 1
          ? `LinkedIn · ${byPlatform.LINKEDIN.length} accounts`
          : first.displayName ?? "LinkedIn",
      sub:
        first.expiresAt
          ? `linkedin · token in ${Math.max(
              0,
              Math.round((new Date(first.expiresAt).getTime() - Date.now()) / 86_400_000),
            )}d`
          : "linkedin",
    });
  }
  if (byPlatform.TELEGRAM.length > 0) {
    const first = byPlatform.TELEGRAM[0];
    channels.push({
      platform: "TELEGRAM",
      name:
        byPlatform.TELEGRAM.length > 1
          ? `Telegram · ${byPlatform.TELEGRAM.length} channels`
          : first.displayName ?? first.externalId,
      sub: `telegram · ${first.externalId}`,
    });
  }

  return (
    <ComposeForm
      projectId={project.id}
      channels={channels}
      languages={settings?.languages ?? ["en"]}
    />
  );
}
