import { AlertTriangle } from "lucide-react";
import { daysUntil } from "@/lib/format";

export type ExpiringConnection = {
  id: string;
  platform: "LINKEDIN" | "TELEGRAM";
  displayName: string | null;
  expiresAt: Date | null;
};

const WARN_DAYS = 14;

export function ExpiryBanner({
  projectId,
  connections,
}: {
  projectId: string;
  connections: ExpiringConnection[];
}) {
  // Server component: renders once per request, so reading the wall clock here
  // is intentional and deterministic for this render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const relevant = connections.filter((c) => {
    if (c.platform !== "LINKEDIN") return false;
    if (!c.expiresAt) return false;
    const days = (c.expiresAt.getTime() - now) / 86_400_000;
    return days < WARN_DAYS;
  });

  if (relevant.length === 0) return null;

  const mostUrgent = relevant.reduce((a, b) => {
    const ae = a.expiresAt!.getTime();
    const be = b.expiresAt!.getTime();
    return ae < be ? a : b;
  });
  const expMs = mostUrgent.expiresAt!.getTime();
  const expired = expMs < now;
  const daysLeft = daysUntil(mostUrgent.expiresAt!, now);

  // Error (expired) vs warn (expiring soon) — both drawn from design tokens,
  // matching the .auth-error / .badge-pill.err|warn treatment used elsewhere.
  const tint = expired
    ? { border: "rgba(248,113,113,0.3)", bg: "rgba(248,113,113,0.08)", fg: "var(--err)" }
    : { border: "rgba(250,204,21,0.3)", bg: "rgba(250,204,21,0.08)", fg: "var(--warn)" };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        border: `1px solid ${tint.border}`,
        background: tint.bg,
        borderRadius: "var(--r-2)",
      }}
    >
      <AlertTriangle
        size={16}
        style={{ flex: "none", marginTop: 1, color: tint.fg }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {expired
            ? "Your LinkedIn connection has expired."
            : `LinkedIn connection expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 2, marginBottom: 0 }}>
          {expired
            ? "Reconnect now — posts to LinkedIn will fail until you do."
            : "LinkedIn tokens last 60 days. Reconnect now to avoid an interruption."}
          {relevant.length > 1 ? ` (${relevant.length} connections affected)` : ""}
        </p>
      </div>
      <a
        className={"btn sm" + (expired ? " accent" : "")}
        href={`/api/linkedin/authorize?projectId=${projectId}`}
      >
        {expired ? "Reconnect LinkedIn" : "Reconnect now"}
      </a>
    </div>
  );
}
