import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getSettingsData } from "@/server/settings";
import { SettingsTabs } from "@/components/settings/settings-tabs";

// Ported from src/app/(app)/settings/page.tsx. Lives in the (app) group so it
// inherits the shell layout. The LinkedIn OAuth callback
// (src/routes/api/linkedin/callback.ts) redirects back here with `?li_ok=1` on
// success or `?li_error=<message>` on failure; those are validated here and read
// via Route.useSearch() (surfaced by ConnectionsPanel as a toast). The loader
// data (including the service-role AiCredential read) is assembled in the
// getSettingsData server fn so its server-only imports stay off the client.
const searchSchema = z.object({
  li_ok: z.string().optional(),
  li_error: z.string().optional(),
});

export const Route = createFileRoute("/(app)/settings")({
  validateSearch: searchSchema,
  loader: async () => getSettingsData(),
  component: SettingsPage,
});

function SettingsPage() {
  const initial = Route.useLoaderData();
  return <SettingsTabs initial={initial} />;
}
