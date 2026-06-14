// Schedule math for the worker — the `computeScheduleInfo` half of
// src/lib/schedule.ts (the UI-only `formatRelative` helper is omitted). Logic is
// byte-for-byte identical; only the supabase import path changes.
import { selectProjectWithRelations, supabaseAdmin } from "./supabase.ts";

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
  const { data: project } = await selectProjectWithRelations(
    supabaseAdmin,
    projectId,
  );
  if (!project?.settings) return null;

  const { data: lastPost } = await supabaseAdmin
    .from("Post")
    .select("publishedAt")
    .eq("projectId", projectId)
    .is("error", null)
    .order("publishedAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { intervalDays, preferredHour, timezone, skipDays } = project.settings;
  const lastAt = lastPost?.publishedAt ? new Date(lastPost.publishedAt) : null;
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
