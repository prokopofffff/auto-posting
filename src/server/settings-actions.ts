"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { getCurrentUser, userOwnsProject } from "@/server/project";

const voiceCfgSchema = z.object({
  writingStyle: z.enum([
    "professional",
    "casual",
    "technical",
    "provocative",
    "custom",
  ]),
  customStyle: z.string().max(2000).nullable().optional(),
  includeHashtags: z.coerce.boolean(),
  includeSource: z.coerce.boolean(),
  maxPostChars: z.coerce.number().int().min(200).max(4096),
});

const settingsSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1).max(80),
  topics: z.array(z.string().min(1).max(80)).min(1).max(100),
  audience: z.string().max(500).optional().or(z.literal("")),
  angle: z.string().max(500).optional().or(z.literal("")),
  languages: z.array(z.enum(["en", "ru"])).min(1),
  writingStyle: z.enum(["professional", "casual", "technical", "provocative", "custom"]),
  customStyle: z.string().max(2000).optional().or(z.literal("")),
  intervalDays: z.coerce.number().int().min(1).max(90),
  postsPerDay: z.coerce.number().int().min(1).max(24).default(1),
  preferredHour: z.coerce.number().int().min(0).max(23),
  timezone: z.string().min(1).max(80),
  mode: z.enum(["MANUAL", "AUTOPILOT", "HYBRID"]),
  includeHashtags: z.coerce.boolean(),
  includeSource: z.coerce.boolean(),
  maxPostChars: z.coerce.number().int().min(200).max(3000),
  bannedWords: z.array(z.string().min(1).max(80)).max(200),
  moderationEnabled: z.coerce.boolean(),
  confidenceThreshold: z.coerce.number().int().min(0).max(100).default(80),
  skipDays: z.array(z.coerce.number().int().min(0).max(6)).default([]),
  voiceMode: z.enum(["UNIFIED", "PER_PLATFORM"]).default("UNIFIED"),
  voiceOverrides: z
    .object({
      LINKEDIN: voiceCfgSchema.optional(),
      TELEGRAM: voiceCfgSchema.optional(),
    })
    .nullable()
    .optional(),
});

export type SaveSettingsInput = z.input<typeof settingsSchema>;

export async function saveSettingsAction(input: SaveSettingsInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  if (!(await userOwnsProject(user.id, data.projectId))) {
    return { ok: false as const, error: "Project not found." };
  }

  // The name update and the settings upsert must land together — a single
  // plpgsql function runs both in one transaction (see migration
  // *_save_project_settings_rpc.sql). The settings upsert is keyed on the
  // unique projectId, so the same payload covers create and update.
  await unwrap(
    supabaseAdmin.rpc("save_project_settings", {
      p_project_id: data.projectId,
      p_name: data.projectName,
      p_settings: {
        topics: data.topics,
        audience: data.audience?.trim() || null,
        angle: data.angle?.trim() || null,
        languages: data.languages,
        writingStyle: data.writingStyle,
        customStyle: data.customStyle || null,
        intervalDays: data.intervalDays,
        postsPerDay: data.postsPerDay,
        preferredHour: data.preferredHour,
        timezone: data.timezone,
        mode: data.mode,
        includeHashtags: data.includeHashtags,
        includeSource: data.includeSource,
        maxPostChars: data.maxPostChars,
        bannedWords: data.bannedWords,
        moderationEnabled: data.moderationEnabled,
        confidenceThreshold: data.confidenceThreshold,
        skipDays: data.skipDays,
        voiceMode: data.voiceMode,
        voiceOverrides: data.voiceOverrides ?? null,
      },
    }),
  );

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function toggleProjectStatusAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  if (!(await userOwnsProject(user.id, projectId))) {
    return { ok: false as const, error: "Project not found." };
  }
  const { data: project } = await supabaseAdmin
    .from("Project")
    .select("status")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false as const, error: "Project not found." };

  const next = project.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  await unwrap(
    supabaseAdmin.from("Project").update({ status: next }).eq("id", projectId),
  );
  revalidatePath("/dashboard");
  return { ok: true as const, status: next };
}
