import { createFileRoute } from "@tanstack/react-router";
import { requireCurrentProject } from "@/server/current";
import { daysUntil } from "@/lib/format";
import { ComposeForm, type ComposeChannel } from "@/components/compose/compose-form";

// Ported from src/app/(app)/compose/page.tsx. The (app) shell layout is ported
// in a later phase; this route lives in the (app) group so it inherits it. The
// auth guard in src/start.ts protects the path; requireCurrentProject (a server
// fn) resolves the current project server-side and redirects if the session was
// lost between the guard and the loader. The channel-list transform below is pure
// and runs wherever the loader runs.
export const Route = createFileRoute("/(app)/compose")({
  loader: async () => {
    const project = await requireCurrentProject();
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
        sub: first.expiresAt
          ? `linkedin · token in ${daysUntil(new Date(first.expiresAt))}d`
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

    return {
      projectId: project.id,
      channels,
      languages: settings?.languages ?? ["en"],
    };
  },
  component: ComposePage,
});

function ComposePage() {
  const { projectId, channels, languages } = Route.useLoaderData();
  return (
    <ComposeForm projectId={projectId} channels={channels} languages={languages} />
  );
}
