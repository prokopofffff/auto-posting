import { supabaseAdmin } from "@/lib/supabase/service";
import { selectProjectWithRelations } from "@/lib/supabase/queries";

export type ScheduleInfo = {
  lastAt: Date | null;
  nextAt: Date;
  dueNow: boolean;
  intervalDays: number;
  postsPerDay: number;
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

// Local (project-timezone) weekday for an instant, Mon=0..Sun=6.
function localDayIndex(at: Date, timezone: string): number {
  const offsetMin = parseTzOffsetMinutes(timezone, at);
  return dayIndexOf(new Date(at.getTime() + offsetMin * 60_000));
}

// Push an instant forward whole days until it lands on a non-skipped weekday.
// Used for the intra-day gap slots, where we don't re-anchor to preferredHour.
function avoidSkipDays(at: Date, timezone: string, skipDays: number[]): Date {
  if (skipDays.length === 0) return at;
  const skip = new Set(skipDays);
  let cur = at;
  let guard = 0;
  while (guard < 14 && skip.has(localDayIndex(cur, timezone))) {
    cur = new Date(cur.getTime() + 86_400_000);
    guard += 1;
  }
  return cur;
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
  // The project graph and the "last generation" lookup only need projectId, so
  // fetch them together — this runs once per active project on every tick.
  const [{ data: project }, { data: lastDraft }] = await Promise.all([
    selectProjectWithRelations(supabaseAdmin, projectId),
    // Throttle off the last GENERATED draft, not the last published post. A
    // scheduled run always produces a Draft but only publishes a Post in
    // AUTOPILOT (or HYBRID above threshold, with a verified article) — so keying
    // off Post made MANUAL/HYBRID projects look perpetually "due" and generate a
    // fresh draft on every hourly tick instead of once per slot.
    supabaseAdmin
      .from("Draft")
      .select("createdAt")
      .eq("projectId", projectId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!project?.settings) return null;

  const { intervalDays, preferredHour, timezone, skipDays } = project.settings;
  // Guard the divisor against a stray non-positive value (no DB CHECK enforces
  // it); the column is NOT NULL DEFAULT 1 and zod-validated min 1 otherwise.
  const postsPerDay = Math.max(1, project.settings.postsPerDay);
  const skip = skipDays ?? [];
  // createdAt is an ISO string from supabase-js; parse to a Date for the math.
  const lastAt = lastDraft?.createdAt ? new Date(lastDraft.createdAt) : null;

  // Spacing between two generations. postsPerDay subdivides each interval day
  // into evenly-spaced slots: 1×/day → 24h, 3×/day → 8h, weekly → 168h.
  const gapMs = Math.round((intervalDays * 86_400_000) / postsPerDay);

  // First run anchors to the next preferredHour slot; afterwards we space by the
  // per-slot gap from the last generation, stepping over skipped weekdays.
  const nextAt = lastAt
    ? avoidSkipDays(new Date(lastAt.getTime() + gapMs), timezone, skip)
    : nextRunForHour(new Date(), intervalDays, preferredHour, timezone, skip);

  return {
    lastAt,
    nextAt,
    dueNow: project.status === "ACTIVE" && nextAt.getTime() <= Date.now(),
    intervalDays,
    postsPerDay,
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
