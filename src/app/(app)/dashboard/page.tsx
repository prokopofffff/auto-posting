import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import { computeScheduleInfo } from "@/lib/schedule";
import { relShort } from "@/lib/format";
import { db } from "@/lib/db";
import { ExpiryBanner } from "@/components/expiry-banner";
import { PlatformIcon } from "@/components/platform-icon";
import { Sparkline } from "@/components/sparkline";
import { GenerateNowBtn, PauseToggleBtn } from "@/components/forms/dashboard-actions";

const DAY_MS = 86_400_000;

function startOfDayUTC(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function bucketByDay(timestamps: Date[], days: number): number[] {
  const today = startOfDayUTC(new Date());
  const buckets = Array(days).fill(0) as number[];
  for (const ts of timestamps) {
    const day = startOfDayUTC(ts);
    const diff = Math.round((today.getTime() - day.getTime()) / DAY_MS);
    const idx = days - 1 - diff;
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

function fmtHM(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtDateShort(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getCurrentProject(user.id);
  const settings = project.settings;
  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since14d = new Date(now.getTime() - 14 * DAY_MS);

  const [
    posts7d,
    postsPrev7d,
    drafts7d,
    recentPosts,
    recentDrafts,
    totalPostsCount,
    schedule,
  ] = await Promise.all([
      db.post.findMany({
        where: { projectId: project.id, publishedAt: { gte: since7d } },
        select: { publishedAt: true, error: true },
      }),
      db.post.count({
        where: {
          projectId: project.id,
          publishedAt: { gte: since14d, lt: since7d },
          error: null,
        },
      }),
      db.draft.findMany({
        where: { projectId: project.id, createdAt: { gte: since7d } },
        select: { createdAt: true, topic: true },
      }),
      db.post.findMany({
        where: { projectId: project.id },
        orderBy: { publishedAt: "desc" },
        take: 5,
        select: {
          id: true,
          platform: true,
          language: true,
          content: true,
          publishedAt: true,
          error: true,
        },
      }),
      db.draft.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, topic: true, createdAt: true },
      }),
      db.post.count({
        where: { projectId: project.id, error: null },
      }),
      computeScheduleInfo(project.id),
    ]);

  const successful7d = posts7d.filter((p) => p.error === null);
  const failed7d = posts7d.filter((p) => p.error !== null);
  const successRate =
    posts7d.length === 0
      ? null
      : Math.round((successful7d.length / posts7d.length) * 100);
  const postsDelta = successful7d.length - postsPrev7d;

  const postsSparkline = bucketByDay(
    successful7d.map((p) => p.publishedAt),
    7,
  );
  const successSparkline = (() => {
    // success % per day for the 7 days
    const byDayTotal = bucketByDay(posts7d.map((p) => p.publishedAt), 7);
    const byDayOk = bucketByDay(successful7d.map((p) => p.publishedAt), 7);
    return byDayTotal.map((t, i) => (t === 0 ? 100 : Math.round((byDayOk[i] / t) * 100)));
  })();
  const draftsSparkline = bucketByDay(
    drafts7d.map((d) => d.createdAt),
    7,
  );
  const topicsTotal = settings?.topics?.length ?? 0;
  // Real data: distinct draft topics per day (last 7d) — "topics with activity".
  // Single pass builds the per-day sparkline and the overall active-topic set.
  const today = startOfDayUTC(now);
  const dayTopicSets: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());
  const activeTopics = new Set<string>();
  for (const d of drafts7d) {
    activeTopics.add(d.topic);
    const day = startOfDayUTC(d.createdAt);
    const diff = Math.round((today.getTime() - day.getTime()) / DAY_MS);
    const idx = 7 - 1 - diff;
    if (idx >= 0 && idx < 7) dayTopicSets[idx].add(d.topic);
  }
  const topicsActiveByDay = dayTopicSets.map((s) => s.size);
  const topicsWithActivity = activeTopics.size;
  const topicsIdle = Math.max(0, topicsTotal - topicsWithActivity);

  const hasAnyTopic = topicsTotal > 0;
  const hasConnection = project.connectedAccounts.length > 0;
  const hasPublished = totalPostsCount > 0;

  const checklist = [
    {
      id: 1,
      title: "Pick topics + voice",
      sub: "Configure what the agent writes about and in what tone.",
      done: hasAnyTopic,
      cta: { href: "/settings", label: "Open settings" },
    },
    {
      id: 2,
      title: "Connect at least 1 account",
      sub: "LinkedIn or Telegram so posts have somewhere to go.",
      done: hasConnection,
      cta: { href: "/settings", label: "Connect account" },
    },
    {
      id: 3,
      title: "Generate first post",
      sub: "Fetch a fresh article, let Claude draft, approve, ship.",
      done: hasPublished,
      cta: { href: "/drafts", label: "Open drafts" },
    },
  ];
  const checklistDone = checklist.filter((c) => c.done).length;

  // ----- Activity timeline (mix posts + drafts, last 8 by time) -----
  type TLItem = { ts: Date; kind: "ok" | "err" | "info"; head: string; tail: string };
  const tlItems: TLItem[] = [];
  for (const p of recentPosts) {
    const isErr = p.error !== null;
    tlItems.push({
      ts: p.publishedAt,
      kind: isErr ? "err" : "ok",
      head: isErr ? "Failed" : "Published",
      tail: `${p.platform.toLowerCase()} · ${p.language} · ${p.content.length} chars${
        isErr ? ` — ${p.error}` : ""
      }`,
    });
  }
  for (const d of recentDrafts) {
    tlItems.push({
      ts: d.createdAt,
      kind: "info",
      head: "Draft",
      tail: `Generated · ${d.topic}`,
    });
  }
  tlItems.sort((a, b) => b.ts.getTime() - a.ts.getTime());
  const timeline = tlItems.slice(0, 8).map((it) => {
    const sameDay = it.ts.toDateString() === now.toDateString();
    return {
      when: sameDay ? fmtHM(it.ts) : fmtDateShort(it.ts).slice(5),
      ...it,
    };
  });

  // ----- Upcoming queue -----
  // `at` is the real timestamp (ms) used for ordering; `in` is the display label only.
  type UpItem = { at: number; in: string; what: string; where: string };
  const upcoming: UpItem[] = [];
  if (schedule && project.status === "ACTIVE") {
    upcoming.push({
      at: schedule.nextAt.getTime(),
      in: relShort(schedule.nextAt),
      what: "Scheduled run",
      where: `${topicsTotal} topics`,
    });
  }
  for (const a of project.connectedAccounts) {
    if (!a.expiresAt) continue;
    const diffDays = Math.round((a.expiresAt.getTime() - now.getTime()) / DAY_MS);
    if (diffDays <= 30 && diffDays >= 0) {
      upcoming.push({
        at: a.expiresAt.getTime(),
        in: `${diffDays}d`,
        what: "Token refresh",
        where: `${a.platform.toLowerCase()} — expires ${a.expiresAt.toISOString().slice(0, 10)}`,
      });
    }
  }
  upcoming.sort((a, b) => a.at - b.at);

  const langs = settings?.languages ?? ["en"];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{project.name}</h1>
          <div className="page-sub mono" style={{ fontSize: 11.5 }}>
            project_id <span className="muted-2">{project.id.slice(0, 10)}</span>
            {" · "}created{" "}
            <span className="muted-2">{fmtDateShort(project.createdAt)}</span>
            {schedule && project.status === "ACTIVE" ? (
              <>
                {" · "}next run in{" "}
                <span style={{ color: "var(--accent)" }}>
                  {relShort(schedule.nextAt)}
                </span>
              </>
            ) : (
              <>
                {" · "}
                <span style={{ color: "var(--warn)" }}>paused</span>
              </>
            )}
          </div>
        </div>
        <div className="hdr-right">
          <PauseToggleBtn projectId={project.id} status={project.status} />
          <GenerateNowBtn projectId={project.id} />
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

      <div className="grid-cols-4" style={{ marginBottom: 18, marginTop: 16 }}>
        <div className="kpi">
          <div className="label">posts · 7d</div>
          <div className="value">{successful7d.length}</div>
          <div className={"delta" + (postsDelta > 0 ? " up" : postsDelta < 0 ? " down" : "")}>
            {postsDelta > 0 ? "↑ " : postsDelta < 0 ? "↓ " : ""}
            {postsDelta >= 0 ? "+" : ""}
            {postsDelta} vs prev
          </div>
          <div className="sparkline">
            <Sparkline data={postsSparkline} />
          </div>
        </div>
        <div className="kpi">
          <div className="label">success rate</div>
          <div className="value">
            {successRate ?? "—"}
            {successRate !== null && <span className="unit">%</span>}
          </div>
          <div className="delta">
            {failed7d.length} failed · {successful7d.length} ok
          </div>
          <div className="sparkline">
            <Sparkline data={successSparkline} color="var(--ok)" />
          </div>
        </div>
        <div className="kpi">
          <div className="label">topics active · 7d</div>
          <div className="value">
            {topicsWithActivity}
            <span className="unit">/ {topicsTotal}</span>
          </div>
          <div className="delta">
            {topicsTotal === 0
              ? "add your first topic"
              : `${topicsIdle} idle this week`}
          </div>
          <div className="sparkline">
            <Sparkline data={topicsActiveByDay} color="var(--info)" />
          </div>
        </div>
        <div className="kpi">
          <div className="label">drafts · 7d</div>
          <div className="value">{drafts7d.length}</div>
          <div className="delta">
            generated, pending or shipped
          </div>
          <div className="sparkline">
            <Sparkline data={draftsSparkline} color="var(--warn)" />
          </div>
        </div>
      </div>

      <div className="grid-2-1">
        {/* Left column */}
        <div>
          <div className="dash-card" style={{ marginBottom: 14 }}>
            <div className="dash-card-head">
              <h3 className="dash-card-title">Getting started</h3>
              <span className="mono muted-2" style={{ fontSize: 10.5 }}>
                {checklistDone} / {checklist.length} complete
              </span>
            </div>
            <div className="dash-card-sub">
              finish these to start publishing on autopilot
            </div>
            <div className="dash-card-body">
              <div className="checklist">
                {checklist.map((it) => (
                  <div key={it.id} className={"item" + (it.done ? " done" : "")}>
                    <div className="num">
                      {it.done ? <Check size={12} /> : it.id}
                    </div>
                    <div>
                      <div className="title">{it.title}</div>
                      <div className="sub">{it.sub}</div>
                    </div>
                    <div className="right">
                      {it.done ? (
                        <span className="badge-pill ok">
                          <span className="dot" />
                          done
                        </span>
                      ) : (
                        <Link href={it.cta.href} className="btn xs">
                          {it.cta.label}
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid-cols-3" style={{ marginBottom: 14 }}>
            <div className="dash-card">
              <div className="dash-card-head">
                <h3 className="dash-card-title">Mode</h3>
              </div>
              <div className="dash-card-body">
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {settings?.mode === "AUTOPILOT" ? "Autopilot" : "Manual approval"}
                </div>
                <div className="mono muted-2" style={{ fontSize: 11, marginTop: 2 }}>
                  {settings?.mode === "AUTOPILOT"
                    ? "drafts → publish immediately"
                    : "1-click queue · drafts/"}
                </div>
              </div>
            </div>
            <div className="dash-card">
              <div className="dash-card-head">
                <h3 className="dash-card-title">Schedule</h3>
              </div>
              <div className="dash-card-body">
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {String(settings?.preferredHour ?? 9).padStart(2, "0")}:00{" "}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {settings?.timezone ?? "UTC"}
                  </span>
                </div>
                <div className="mono muted-2" style={{ fontSize: 11, marginTop: 2 }}>
                  every {settings?.intervalDays ?? 1}d
                </div>
              </div>
            </div>
            <div className="dash-card">
              <div className="dash-card-head">
                <h3 className="dash-card-title">Languages</h3>
              </div>
              <div className="dash-card-body">
                <div style={{ display: "flex", gap: 6 }}>
                  {langs.map((l, i) => (
                    <span
                      key={l}
                      className={"badge-pill mono " + (i === 0 ? "accent" : "")}
                    >
                      {l}
                    </span>
                  ))}
                </div>
                <div className="mono muted-2" style={{ fontSize: 11, marginTop: 4 }}>
                  {langs.length > 1 ? "parallel drafts per language" : "single language"}
                </div>
              </div>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-head">
              <h3 className="dash-card-title">Connected accounts</h3>
              <Link href="/settings" className="btn xs ghost">
                <Plus size={11} />
                <span>Connect</span>
              </Link>
            </div>
            <div className="dash-card-body">
              {project.connectedAccounts.length === 0 ? (
                <div className="muted" style={{ padding: "8px 0" }}>
                  No accounts connected yet.{" "}
                  <Link href="/settings" style={{ color: "var(--accent)" }}>
                    Connect one →
                  </Link>
                </div>
              ) : (
                project.connectedAccounts.map((c) => {
                  const expiresIn = c.expiresAt
                    ? `expires in ${Math.max(
                        0,
                        Math.round((c.expiresAt.getTime() - now.getTime()) / DAY_MS),
                      )} days`
                    : "no expiry";
                  return (
                    <div className="dash-row" key={c.id}>
                      <PlatformIcon platform={c.platform} size={16} />
                      <div>
                        <div className="title">{c.displayName ?? c.externalId}</div>
                        <div className="sub mono">
                          {c.platform.toLowerCase()} · {expiresIn}
                        </div>
                      </div>
                      <div className="right">
                        <span className="badge-pill ok">
                          <span className="dot" />
                          live
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              {(["LINKEDIN", "TELEGRAM"] as const)
                .filter((p) => !project.connectedAccounts.some((c) => c.platform === p))
                .map((p) => (
                  <div className="dash-row" style={{ opacity: 0.6 }} key={p}>
                    <PlatformIcon platform={p} size={16} />
                    <div>
                      <div className="title">
                        {p === "LINKEDIN" ? "LinkedIn" : "Telegram"}
                      </div>
                      <div className="sub mono">not connected</div>
                    </div>
                    <div className="right">
                      <Link href="/settings" className="btn xs ghost">Connect</Link>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div>
          <div className="dash-card" style={{ marginBottom: 14 }}>
            <div className="dash-card-head">
              <h3 className="dash-card-title">Upcoming</h3>
            </div>
            <div className="dash-card-body" style={{ padding: 0 }}>
              {upcoming.length === 0 ? (
                <div className="muted" style={{ padding: "12px 14px" }}>
                  Nothing scheduled.
                </div>
              ) : (
                upcoming.map((u, i) => (
                  <div key={i} className="upcoming-row">
                    <span className="when">{u.in}</span>
                    <span>{u.what}</span>
                    <span className="where">{u.where}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-head">
              <h3 className="dash-card-title">Activity</h3>
              <Link href="/analytics" className="btn xs ghost">
                <span>full log</span>
              </Link>
            </div>
            <div className="dash-card-body">
              <div className="timeline">
                {timeline.length === 0 ? (
                  <div className="muted">No activity yet.</div>
                ) : (
                  timeline.map((it, i) => (
                    <div key={i} className={"tl-item " + it.kind}>
                      <span className="when">{it.when}</span>
                      <span className="what">
                        <b>{it.head}</b>{" "}
                        <span className="mono">· {it.tail}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
