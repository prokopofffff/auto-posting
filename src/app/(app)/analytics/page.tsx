import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import { getAnalytics } from "@/server/analytics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnalyticsSparkline } from "@/components/analytics-sparkline";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getCurrentProject(user.id);
  const a = await getAnalytics(project.id);

  const successRate =
    a.totalPublished + a.totalFailed === 0
      ? null
      : Math.round((a.totalPublished / (a.totalPublished + a.totalFailed)) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          What your agent has been doing, last 30 days.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Published, last 7 days</CardDescription>
            <CardTitle className="text-2xl">{a.published7d}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Published, last 30 days</CardDescription>
            <CardTitle className="text-2xl">{a.published30d}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>All-time published</CardDescription>
            <CardTitle className="text-2xl">{a.totalPublished}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Success rate</CardDescription>
            <CardTitle className="text-2xl">
              {successRate === null ? "—" : `${successRate}%`}
              {a.totalFailed > 0 ? (
                <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                  {a.totalFailed} failed
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily activity</CardTitle>
          <CardDescription>
            Posts per day, last 30 days. Dark = published, red = failed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnalyticsSparkline data={a.dailyCounts} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By platform</CardTitle>
            <CardDescription>Last 30 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {a.byPlatform.every((p) => p.published + p.failed === 0) ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              a.byPlatform.map((p) => {
                const total = p.published + p.failed;
                const ratio = total === 0 ? 0 : (p.published / total) * 100;
                return (
                  <div key={p.platform} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{p.platform}</span>
                      <span className="text-muted-foreground">
                        {p.published} / {total}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-foreground/80"
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top topics</CardTitle>
            <CardDescription>Where your published posts came from.</CardDescription>
          </CardHeader>
          <CardContent>
            {a.byTopic.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {a.byTopic.map((t) => (
                  <Badge key={t.topic} variant="secondary" className="text-sm">
                    {t.topic} · {t.count}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
