import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentProject } from "@/server/project";
import { SettingsTabs } from "@/components/settings/settings-tabs";

type Platform = "LINKEDIN" | "TELEGRAM";

type VoiceCfg = {
  writingStyle: "professional" | "casual" | "technical" | "provocative" | "custom";
  customStyle: string;
  includeHashtags: boolean;
  includeSource: boolean;
  maxPostChars: number;
};

function normalizeOverrides(raw: unknown): Partial<Record<Platform, VoiceCfg>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<Platform, VoiceCfg>> = {};
  for (const key of ["LINKEDIN", "TELEGRAM"] as const) {
    const v = (raw as Record<string, unknown>)[key];
    if (!v || typeof v !== "object") continue;
    const c = v as Record<string, unknown>;
    out[key] = {
      writingStyle: (c.writingStyle as VoiceCfg["writingStyle"]) ?? "professional",
      customStyle: typeof c.customStyle === "string" ? c.customStyle : "",
      includeHashtags: Boolean(c.includeHashtags),
      includeSource: Boolean(c.includeSource),
      maxPostChars:
        typeof c.maxPostChars === "number" ? c.maxPostChars : 2200,
    };
  }
  return out;
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const project = await getCurrentProject(user.id);
  const s = project.settings;

  return (
    <SettingsTabs
      initial={{
        projectId: project.id,
        projectName: project.name,
        topics: s?.topics ?? [],
        languages: s?.languages ?? ["en"],
        writingStyle: (s?.writingStyle ?? "professional") as VoiceCfg["writingStyle"],
        customStyle: s?.customStyle ?? "",
        intervalDays: s?.intervalDays ?? 1,
        preferredHour: s?.preferredHour ?? 9,
        timezone: s?.timezone ?? "UTC",
        mode: (s?.mode ?? "MANUAL") as "MANUAL" | "AUTOPILOT" | "HYBRID",
        includeHashtags: s?.includeHashtags ?? true,
        includeSource: s?.includeSource ?? true,
        maxPostChars: s?.maxPostChars ?? 2200,
        bannedWords: s?.bannedWords ?? [],
        moderationEnabled: s?.moderationEnabled ?? false,
        confidenceThreshold: s?.confidenceThreshold ?? 80,
        skipDays: s?.skipDays ?? [],
        voiceMode: (s?.voiceMode ?? "UNIFIED") as "UNIFIED" | "PER_PLATFORM",
        voiceOverrides: normalizeOverrides(s?.voiceOverrides),
        connections: project.connectedAccounts.map((c) => ({
          id: c.id,
          platform: c.platform,
          externalId: c.externalId,
          displayName: c.displayName,
          expiresAt: c.expiresAt,
        })),
      }}
    />
  );
}
