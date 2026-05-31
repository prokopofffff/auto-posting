// Shared display formatters for dates/times across the dashboard UI.

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Compact magnitude with no suffix: "5m" / "3h" / "2d". Used for "next run in …" style labels. */
export function relShort(target: Date, now = new Date()): string {
  const abs = Math.abs(target.getTime() - now.getTime());
  if (abs < HOUR) return `${Math.round(abs / MIN)}m`;
  if (abs < 2 * DAY) return `${Math.round(abs / HOUR)}h`;
  return `${Math.round(abs / DAY)}d`;
}

/** Past-tense relative time: "just now" / "5m ago" / "3h ago" / "2d ago". Returns "—" for null. */
export function relAgo(iso: string | null, now = new Date()): string {
  if (!iso) return "—";
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.round(diff / MIN)}m ago`;
  if (diff < 2 * DAY) return `${Math.round(diff / HOUR)}h ago`;
  return `${Math.round(diff / DAY)}d ago`;
}

/** Absolute "26/05/2026 · 15:43". */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB")} · ${fmtTimeOnly(iso)}`;
}

/** Absolute 24h "15:43". */
export function fmtTimeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
