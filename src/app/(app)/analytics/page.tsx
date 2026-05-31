import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import { getAnalytics } from "@/server/analytics";

export const dynamic = "force-dynamic";

function relTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const diff = now.getTime() - d.getTime();
  const mins = Math.round(diff / 60_000);
  const hours = Math.round(diff / 3_600_000);
  const days = Math.round(diff / 86_400_000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) {
    return `${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })} today`;
  }
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getCurrentProject(user.id);
  const a = await getAnalytics(project.id);

  const failed30d = a.dailyCounts.reduce((s, d) => s + d.failed, 0);
  const successRate30d =
    a.published30d + failed30d === 0
      ? null
      : Math.round((a.published30d / (a.published30d + failed30d)) * 100);

  const avgPerDay = a.published30d / 30;

  // Heatmap classification by daily total — 0 / 1 / 2 / 3 / fail
  // Tier breakpoints scale to the busiest day in the window.
  const maxDay = Math.max(1, ...a.dailyCounts.map((d) => d.published));
  const tierFor = (n: number): "0" | "1" | "2" | "3" => {
    if (n === 0) return "0";
    if (n <= Math.ceil(maxDay / 3)) return "1";
    if (n <= Math.ceil((2 * maxDay) / 3)) return "2";
    return "3";
  };

  const maxHour = Math.max(1, ...a.hourBuckets);
  const totalPosts30d = a.byPlatform.reduce(
    (s, p) => s + p.published + p.failed,
    0,
  );
  const channelsActive = a.byPlatform.filter(
    (p) => p.published + p.failed > 0,
  ).length;
  const topTopicMax = Math.max(1, ...a.byTopic.map((t) => t.count));

  // Delta vs prev 30d
  let deltaPct: number | null = null;
  if (a.publishedPrev30d > 0) {
    deltaPct = Math.round(
      ((a.published30d - a.publishedPrev30d) / a.publishedPrev30d) * 100,
    );
  } else if (a.published30d > 0) {
    deltaPct = 100;
  }

  // X-axis tick labels for heatmap (every 9 days)
  const heatLabels = [0, 9, 18, 29].map((i) => a.dailyCounts[i]?.day.slice(5) ?? "");

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Analytics</h1>
          <div className="page-sub">
            What the agent has been doing — last 30 days.
          </div>
        </div>
        <div className="hdr-right">
          <div className="page-meta">
            <span>
              <b>{a.published30d}</b> published
            </span>
            <span>
              <b>{failed30d}</b> failed
            </span>
            <span>
              <b>{channelsActive}</b> channels active
            </span>
          </div>
        </div>
      </div>

      <div className="grid-cols-4" style={{ marginBottom: 18 }}>
        <div className="kpi">
          <div className="label">published · 30d</div>
          <div className="value">{a.published30d}</div>
          <div
            className={
              "delta" +
              (deltaPct !== null && deltaPct > 0
                ? " up"
                : deltaPct !== null && deltaPct < 0
                ? " down"
                : "")
            }
          >
            {deltaPct === null
              ? "no prior data"
              : `${deltaPct >= 0 ? "↑ +" : "↓ "}${Math.abs(deltaPct)}% vs prev 30d`}
          </div>
        </div>
        <div className="kpi">
          <div className="label">success rate · 30d</div>
          <div className="value">
            {successRate30d ?? "—"}
            {successRate30d !== null && <span className="unit">%</span>}
          </div>
          <div className="delta">
            {a.published30d} ok · {failed30d} failed
          </div>
        </div>
        <div className="kpi">
          <div className="label">avg / day</div>
          <div className="value">{avgPerDay.toFixed(2)}</div>
          <div className="delta mono">
            7d · {a.published7d} · all-time · {a.totalPublished}
          </div>
        </div>
        <div className="kpi">
          <div className="label">spend · 30d</div>
          <div className="value">
            ${a.spend30dUsd.toFixed(2)}
          </div>
          <div className="delta mono">
            {a.spendPerPostUsd !== null
              ? `≈ $${a.spendPerPostUsd.toFixed(3)} / post`
              : "no posts yet"}
            {" · "}
            {(a.tokensIn30d / 1000).toFixed(1)}k in ·{" "}
            {(a.tokensOut30d / 1000).toFixed(1)}k out
          </div>
        </div>
      </div>

      {/* Daily heatmap */}
      <div className="dash-card" style={{ marginBottom: 14 }}>
        <div className="dash-card-head">
          <h3 className="dash-card-title">Daily activity</h3>
          <span className="mono muted-2" style={{ fontSize: 10.5 }}>
            30 days · darker = more posts · red = failed
          </span>
        </div>
        <div className="dash-card-body">
          <div className="heat">
            {a.dailyCounts.map((d) => {
              const v =
                d.failed > 0 && d.published === 0
                  ? "fail"
                  : tierFor(d.published);
              return (
                <div
                  key={d.day}
                  className="cell"
                  data-v={v}
                  title={`${d.day}: ${d.published} ok${d.failed ? `, ${d.failed} failed` : ""}`}
                />
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            {heatLabels.map((l, i) => (
              <span key={i} className="mono muted-2" style={{ fontSize: 10 }}>
                {l}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2-1" style={{ marginBottom: 14 }}>
        {/* Posting hours */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h3 className="dash-card-title">Posting hours · utc</h3>
            <span className="mono muted-2" style={{ fontSize: 10.5 }}>
              aggregated 30d
            </span>
          </div>
          <div className="dash-card-body">
            <div className="bars" style={{ marginBottom: 24 }}>
              {a.hourBuckets.map((v, i) => (
                <div
                  key={i}
                  className="b"
                  style={{ height: `${(v / maxHour) * 100}%` }}
                  data-d={i % 2 === 0 ? String(i).padStart(2, "0") : ""}
                  title={`${String(i).padStart(2, "0")}:00 — ${v} posts`}
                />
              ))}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 8,
              }}
            >
              <span className="mono muted-2" style={{ fontSize: 10 }}>
                00:00
              </span>
              <span className="mono muted-2" style={{ fontSize: 10 }}>
                12:00
              </span>
              <span className="mono muted-2" style={{ fontSize: 10 }}>
                23:00
              </span>
            </div>
          </div>
        </div>

        {/* By platform */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h3 className="dash-card-title">By platform</h3>
          </div>
          <div
            className="dash-card-body"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            {totalPosts30d === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                No activity yet.
              </div>
            ) : (
              a.byPlatform.map((p) => {
                const total = p.published + p.failed;
                const pct =
                  totalPosts30d === 0
                    ? 0
                    : Math.round((p.published / totalPosts30d) * 100);
                const color =
                  p.platform === "LINKEDIN" ? "#60a5fa" : "#34d399";
                return (
                  <div key={p.platform}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontSize: 12 }}>
                        {p.platform === "LINKEDIN" ? "LinkedIn" : "Telegram"}
                      </span>
                      <span className="mono muted" style={{ fontSize: 11 }}>
                        {p.published} · {pct}%
                        {p.failed > 0 && (
                          <span style={{ color: "var(--err)" }}>
                            {" "}
                            · {p.failed} failed
                          </span>
                        )}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: "var(--surface-3)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{ height: "100%", width: `${pct}%`, background: color }}
                      />
                    </div>
                    <div className="mono muted-2" style={{ fontSize: 10, marginTop: 2 }}>
                      total {total}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="grid-2-1">
        {/* Top topics */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h3 className="dash-card-title">Top topics</h3>
            <span className="mono muted-2" style={{ fontSize: 10.5 }}>
              by published count
            </span>
          </div>
          <div
            className="dash-card-body"
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {a.byTopic.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                No activity yet.
              </div>
            ) : (
              a.byTopic.map((t, i) => {
                const pct = Math.round((t.count / topTopicMax) * 100);
                return (
                  <div
                    key={t.topic}
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span
                      className="mono muted-2"
                      style={{ fontSize: 10, width: 18 }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        minWidth: 180,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.topic}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 4,
                        background: "var(--surface-3)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${pct}%`,
                          background: "var(--accent)",
                        }}
                      />
                    </div>
                    <span
                      className="mono muted"
                      style={{ fontSize: 11, width: 24, textAlign: "right" }}
                    >
                      {t.count}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent failures */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h3 className="dash-card-title">Recent failures</h3>
            <span className="badge-pill err">
              <span className="dot" />
              {a.recentFailures.length}
            </span>
          </div>
          <div className="dash-card-body" style={{ padding: 0 }}>
            {a.recentFailures.length === 0 ? (
              <div
                className="muted"
                style={{ fontSize: 12, padding: "12px 14px" }}
              >
                No failures in the last 30 days. 🙌
              </div>
            ) : (
              a.recentFailures.map((f, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 14px",
                    borderTop: i ? "1px solid var(--border)" : "none",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      className="badge-pill err mono"
                      style={{ textTransform: "none" }}
                    >
                      {f.platform.toLowerCase()}
                    </span>
                    <span
                      className="mono muted-2"
                      style={{ fontSize: 10.5, marginLeft: "auto" }}
                    >
                      {relTime(f.when)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>{f.topic}</div>
                  <div
                    className="mono muted"
                    style={{ fontSize: 11, marginTop: 2 }}
                  >
                    {f.reason}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
