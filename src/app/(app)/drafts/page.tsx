import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import { DraftList } from "@/components/forms/draft-list";
import { FailedDrafts } from "@/components/forms/failed-drafts";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getCurrentProject(user.id);

  const drafts = await db.draft.findMany({
    where: { projectId: project.id, status: { in: ["PENDING", "APPROVED", "SCHEDULED"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const failedDrafts = await db.draft.findMany({
    where: { projectId: project.id, status: "FAILED" },
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: {
      posts: {
        where: { error: { not: null } },
        orderBy: { publishedAt: "desc" },
        select: { id: true, platform: true, error: true, publishedAt: true },
      },
    },
  });

  const recentPosts = await db.post.findMany({
    where: { projectId: project.id, error: null },
    orderBy: { publishedAt: "desc" },
    take: 10,
    include: { draft: { select: { sourceTitle: true, sourceUrl: true } } },
  });

  const hasConnection = project.connectedAccounts.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Drafts</h1>
        <p className="text-sm text-muted-foreground">
          Review, edit, and approve generated posts.
        </p>
      </div>

      <DraftList
        projectId={project.id}
        hasConnection={hasConnection}
        drafts={drafts.map((d) => ({
          id: d.id,
          topic: d.topic,
          sourceTitle: d.sourceTitle,
          sourceUrl: d.sourceUrl,
          targets: d.targets,
          createdAt: d.createdAt.toISOString(),
          contentByLang: d.contentByLang as Record<string, string>,
          status: d.status,
        }))}
      />

      {failedDrafts.length > 0 && (
        <FailedDrafts
          drafts={failedDrafts.map((d) => ({
            id: d.id,
            sourceTitle: d.sourceTitle,
            updatedAt: d.updatedAt.toISOString(),
            errors: d.posts.map((p) => ({
              platform: p.platform,
              error: p.error ?? "Unknown error",
            })),
          }))}
        />
      )}

      <div>
        <h2 className="mt-8 text-lg font-semibold">Recent posts</h2>
        {recentPosts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing published yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recentPosts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-md border bg-background p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {p.draft?.sourceTitle ?? p.content.slice(0, 80)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.platform} · {p.language} ·{" "}
                    {new Date(p.publishedAt).toLocaleString()}
                  </div>
                </div>
                {p.externalUrl ? (
                  <a
                    className="ml-3 text-xs underline"
                    href={p.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
