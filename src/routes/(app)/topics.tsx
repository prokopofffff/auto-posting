import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getTopicsData } from "@/server/topics";
import { TopicsTable } from "@/components/topics/topics-table";

// Ported from src/app/(app)/topics/page.tsx. The (app) shell layout is ported in
// a later phase; this route lives in the (app) group so it inherits it. The auth
// guard in src/start.ts protects the path; the loader data (including the
// service-role Draft/Post query) is assembled in the getTopicsData server fn so
// its server-only imports stay off the client. The old `searchParams.import`
// becomes a validated `?import` search param read via Route.useSearch().
const searchSchema = z.object({
  import: z.string().optional(),
});

export const Route = createFileRoute("/(app)/topics")({
  validateSearch: searchSchema,
  loader: async () => getTopicsData(),
  component: TopicsPage,
});

function TopicsPage() {
  const { projectId, projectLanguages, rows, nextRunRel } =
    Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <TopicsTable
      projectId={projectId}
      projectLanguages={projectLanguages}
      initialRows={rows}
      nextRunRel={nextRunRel}
      autoOpenImport={search.import === "1"}
    />
  );
}
