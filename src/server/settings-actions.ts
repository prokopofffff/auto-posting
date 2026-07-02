import { createServerFn } from "@tanstack/react-start";
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

// The validator runs on both client and server, so it stays a plain passthrough:
// we keep the strict `safeParse` inside the handler to preserve the friendly
// `{ ok, error }` return contract instead of throwing from the validator.
function saveSettingsValidator(input: SaveSettingsInput): SaveSettingsInput {
  return input;
}

// Calling convention from a client component:
//   const res = await saveSettingsAction({ data: input })
// After a successful save, the caller does `await router.invalidate()` (the
// old revalidatePath("/settings") / revalidatePath("/dashboard") lived here).
export const saveSettingsAction = createServerFn({ method: "POST" })
  .validator(saveSettingsValidator)
  .handler(async ({ data: input }) => {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Not signed in." };

    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false as const,
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
      };
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

    return { ok: true as const };
  });

// Validator runs on both client and server; keep it a plain string coercion.
function projectIdValidator(projectId: unknown): string {
  if (typeof projectId !== "string") throw new Error("Expected a project id");
  return projectId;
}

// Calling convention from a client component:
//   const res = await toggleProjectStatusAction({ data: projectId })
// After a successful toggle, the caller does `await router.invalidate()` (the
// old revalidatePath("/dashboard") lived here).
export const toggleProjectStatusAction = createServerFn({ method: "POST" })
  .validator(projectIdValidator)
  .handler(async ({ data: projectId }) => {
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
    return { ok: true as const, status: next };
  });
