"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/service";
import {
  selectProjectWithRelations,
  unwrap,
} from "@/lib/supabase/queries";
import { getCurrentUser, userOwnsProject } from "@/server/project";
import { publishDraft } from "@/server/publish";
import { generateAdHocPost } from "@/lib/claude";
import type { Platform } from "@/lib/types";

const composeInputSchema = z.object({
  projectId: z.string().min(1),
  topic: z.string().trim().min(1).max(120),
  sourceUrl: z.string().trim().url().optional().or(z.literal("")),
  content: z.string().min(1).max(8000),
  language: z.string().min(1).max(8),
  targets: z.array(z.enum(["LINKEDIN", "TELEGRAM"])).min(1),
});

const sendSchema = composeInputSchema.extend({
  mode: z.literal("now"),
});
const scheduleSchema = composeInputSchema.extend({
  mode: z.literal("schedule"),
  scheduledAt: z.string().min(1),
});
const draftSchema = composeInputSchema.extend({
  mode: z.literal("draft"),
});
const composeActionSchema = z.union([sendSchema, scheduleSchema, draftSchema]);
export type ComposeActionInput = z.input<typeof composeActionSchema>;

async function ownedProject(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!(await userOwnsProject(user.id, projectId))) {
    return { ok: false as const, error: "Project not found." };
  }
  const { data: project } = await selectProjectWithRelations(
    supabaseAdmin,
    projectId,
  );
  if (!project) return { ok: false as const, error: "Project not found." };
  return { ok: true as const, project };
}

export async function composeSubmitAction(input: ComposeActionInput) {
  const parsed = composeActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const owned = await ownedProject(data.projectId);
  if (!owned.ok) return owned;

  const targets = data.targets as Platform[];

  for (const t of targets) {
    const conns = owned.project.connectedAccounts.filter((c) => c.platform === t);
    if (conns.length === 0) {
      return {
        ok: false as const,
        error: `No connected ${t.toLowerCase()} account.`,
      };
    }
  }

  const scheduledAt =
    data.mode === "schedule" ? new Date(data.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    return { ok: false as const, error: "Invalid scheduled time." };
  }
  if (scheduledAt && scheduledAt.getTime() <= Date.now() - 60_000) {
    return { ok: false as const, error: "Scheduled time is in the past." };
  }

  const status =
    data.mode === "now"
      ? "APPROVED"
      : data.mode === "schedule"
      ? "SCHEDULED"
      : "PENDING";

  const draft = await unwrap(
    supabaseAdmin
      .from("Draft")
      .insert({
        projectId: data.projectId,
        topic: data.topic,
        sourceUrl: data.sourceUrl || null,
        contentByLang: { [data.language]: data.content },
        targets,
        status,
        scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
      })
      .select()
      .single(),
  );

  if (data.mode === "now") {
    const res = await publishDraft(draft.id);
    revalidatePath("/drafts");
    revalidatePath("/dashboard");
    revalidatePath("/compose");
    if (!res.ok) return { ok: false as const, error: res.error };
    return { ok: true as const, mode: "now" as const, draftId: draft.id };
  }

  revalidatePath("/drafts");
  revalidatePath("/dashboard");
  revalidatePath("/compose");
  return { ok: true as const, mode: data.mode, draftId: draft.id };
}

const aiInputSchema = z.object({
  projectId: z.string().min(1),
  topic: z.string().trim().min(1).max(200),
  sourceUrl: z.string().trim().url().optional().or(z.literal("")),
  tone: z.enum(["professional", "casual", "technical", "provocative"]),
  language: z.string().min(1).max(8),
});

export async function aiComposeDraftAction(input: z.input<typeof aiInputSchema>) {
  const parsed = aiInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  const owned = await ownedProject(data.projectId);
  if (!owned.ok) return owned;

  const s = owned.project.settings;
  try {
    const result = await generateAdHocPost({
      topic: data.topic,
      sourceUrl: data.sourceUrl || null,
      tone: data.tone,
      customStyle: s?.customStyle ?? null,
      language: data.language,
      includeHashtags: s?.includeHashtags ?? true,
      includeSource: s?.includeSource ?? true,
      maxChars: s?.maxPostChars ?? 2200,
    });
    return { ok: true as const, content: result.content, costUsd: result.costUsd };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}
