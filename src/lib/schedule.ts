import { db } from "@/lib/db";

export type ScheduleInfo = {
  lastAt: Date | null;
  nextAt: Date;
  dueNow: boolean;
  intervalDays: number;
  preferredHour: number;
  timezone: string;
};

function parseTzOffsetMinutes(timezone: string, at: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = fmt.formatToParts(at);
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
    const asUtcMs = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    return Math.round((asUtcMs - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

// Mon=0..Sun=6
function dayIndexOf(d: Date): number {
  const js = d.getUTCDay();
  return js === 0 ? 6 : js - 1;
}

function nextRunForHour(
  baseline: Date,
  intervalDays: number,
  preferredHour: number,
  timezone: string,
  skipDays: number[] = [],
): Date {
  const offsetMin = parseTzOffsetMinutes(timezone, baseline);
  const localMs = baseline.getTime() + offsetMin * 60_000;
  const local = new Date(localMs);
  local.setUTCHours(preferredHour, 0, 0, 0);
  if (local.getTime() <= localMs) {
    local.setUTCDate(local.getUTCDate() + intervalDays);
  }
  // Step forward day-by-day while landing on a skipped day, up to 14 days defensively.
  const skip = new Set(skipDays);
  let guard = 0;
  while (skip.has(dayIndexOf(local)) && guard < 14) {
    local.setUTCDate(local.getUTCDate() + 1);
    guard += 1;
  }
  const utcCandidate = new Date(local.getTime() - offsetMin * 60_000);
  return utcCandidate;
}

export async function computeScheduleInfo(projectId: string): Promise<ScheduleInfo | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { settings: true },
  });
  if (!project?.settings) return null;

  const lastPost = await db.post.findFirst({
    where: { projectId, error: null },
    orderBy: { publishedAt: "desc" },
    select: { publishedAt: true },
  });

  const { intervalDays, preferredHour, timezone, skipDays } = project.settings;
  const lastAt = lastPost?.publishedAt ?? null;
  const baseline = lastAt
    ? new Date(lastAt.getTime() + intervalDays * 86_400_000 - 86_400_000)
    : new Date();

  const nextAt = nextRunForHour(
    baseline,
    intervalDays,
    preferredHour,
    timezone,
    skipDays ?? [],
  );
  return {
    lastAt,
    nextAt,
    dueNow: project.status === "ACTIVE" && nextAt.getTime() <= Date.now(),
    intervalDays,
    preferredHour,
    timezone,
  };
}

export function formatRelative(target: Date, now = new Date()): string {
  const diffMs = target.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const sign = diffMs < 0 ? "ago" : "in";
  if (mins < 1) return "now";
  if (mins < 60) return `${sign} ${mins}m`;
  if (hours < 48) return `${sign} ${hours}h`;
  return `${sign} ${days}d`;
}
