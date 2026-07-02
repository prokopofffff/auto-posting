import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getDraftsData } from "@/server/drafts";
import { DraftsPane } from "@/components/drafts/drafts-pane";

// Ported from src/app/(app)/drafts/page.tsx. The `?status` search param selects
// the drafts filter (unknown/absent -> "pending", handled in the server fn).
const searchSchema = z.object({
  status: z.string().optional(),
});

export const Route = createFileRoute("/(app)/drafts")({
  validateSearch: searchSchema,
  // Re-run the loader when ?status changes so the correct filter is fetched.
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => getDraftsData({ data: deps.status }),
  component: DraftsPage,
});

function DraftsPage() {
  const { drafts, counts, activeFilter } = Route.useLoaderData();
  return (
    <DraftsPane drafts={drafts} counts={counts} activeFilter={activeFilter} />
  );
}
