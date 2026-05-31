"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/project";

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
  languages: z.array(z.enum(["en", "ru"])).min(1),
  writingStyle: z.enum(["professional", "casual", "technical", "provocative", "custom"]),
  customStyle: z.string().max(2000).optional().or(z.literal("")),
  intervalDays: z.coerce.number().int().min(1).max(90),
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

  const project = await db.project.findFirst({
    where: {
      id: data.projectId,
      org: { members: { some: { userId: user.id } } },
    },
  });
  if (!project) return { ok: false as const, error: "Project not found." };

  await db.$transaction([
    db.project.update({
      where: { id: project.id },
      data: { name: data.projectName },
    }),
    db.projectSettings.upsert({
      where: { projectId: project.id },
      create: {
        projectId: project.id,
        topics: data.topics,
        languages: data.languages,
        writingStyle: data.writingStyle,
        customStyle: data.customStyle || null,
        intervalDays: data.intervalDays,
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
        voiceOverrides: data.voiceOverrides
          ? (data.voiceOverrides as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      update: {
        topics: data.topics,
        languages: data.languages,
        writingStyle: data.writingStyle,
        customStyle: data.customStyle || null,
        intervalDays: data.intervalDays,
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
        voiceOverrides: data.voiceOverrides
          ? (data.voiceOverrides as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    }),
  ]);

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function toggleProjectStatusAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const project = await db.project.findFirst({
    where: { id: projectId, org: { members: { some: { userId: user.id } } } },
  });
  if (!project) return { ok: false as const, error: "Project not found." };

  const next = project.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  await db.project.update({ where: { id: project.id }, data: { status: next } });
  revalidatePath("/dashboard");
  return { ok: true as const, status: next };
}
