import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/service";
import {
  selectProjectWithRelations,
  unwrap,
} from "@/lib/supabase/queries";
import { getCurrentUser, userOwnsProject } from "@/server/project";
import { publishDraft } from "@/server/publish";
import { invokeEdge } from "@/server/edge";
import { uploadProjectImage } from "@/lib/upload-image";
import type { Platform } from "@/lib/types";

const composeInputSchema = z.object({
  projectId: z.string().min(1),
  topic: z.string().trim().min(1).max(120),
  sourceUrl: z.string().trim().url().optional().or(z.literal("")),
  content: z.string().min(1).max(8000),
  language: z.string().min(1).max(8),
  targets: z.array(z.enum(["LINKEDIN", "TELEGRAM"])).min(1),
  imageUrl: z.string().url().optional(),
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

// The validator runs on both client and server. We accept the raw input the
// caller passes and validate inside the handler (returning a friendly error),
// preserving the old `{ ok, error }` return contract.
function composeInputValidator(data: unknown): ComposeActionInput {
  return data as ComposeActionInput;
}

// Calling convention from a client component:
//   await composeSubmitAction({ data: input })
export const composeSubmitAction = createServerFn({ method: "POST" })
  .validator(composeInputValidator)
  .handler(async ({ data: input }) => {
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
          // Manually composed drafts have a single topic; mirror it into the
          // topics[] set so the column is consistent with pipeline-generated ones.
          topics: data.topic ? [data.topic] : [],
          sourceUrl: data.sourceUrl || null,
          imageUrl: data.imageUrl || null,
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
      if (!res.ok) return { ok: false as const, error: res.error };
      return { ok: true as const, mode: "now" as const, draftId: draft.id };
    }

    return { ok: true as const, mode: data.mode, draftId: draft.id };
  });

// The validator runs on both client and server, so it must accept the raw
// FormData the caller passes and normalize it.
function formDataValidator(data: unknown): FormData {
  if (!(data instanceof FormData)) {
    throw new Error("Expected FormData");
  }
  return data;
}

/**
 * Upload a photo for a compose draft to the public `post-images` bucket and
 * return its public URL. Ownership is verified by projectId before uploading.
 *
 * Calling convention from a client component:
 *   await uploadComposeImageAction({ data: formData })
 */
export const uploadComposeImageAction = createServerFn({ method: "POST" })
  .validator(formDataValidator)
  .handler(async ({ data: formData }) => {
    const projectId = String(formData.get("projectId") ?? "");
    if (!projectId) return { ok: false as const, error: "Missing project." };
    const owned = await ownedProject(projectId);
    if (!owned.ok) return owned;
    return uploadProjectImage(projectId, formData.get("file"));
  });

const aiInputSchema = z.object({
  projectId: z.string().min(1),
  topic: z.string().trim().min(1).max(200),
  sourceUrl: z.string().trim().url().optional().or(z.literal("")),
  tone: z.enum(["professional", "casual", "technical", "provocative"]),
  language: z.string().min(1).max(8),
});

type AiComposeInput = z.input<typeof aiInputSchema>;

function aiInputValidator(data: unknown): AiComposeInput {
  return data as AiComposeInput;
}

// Calling convention from a client component:
//   await aiComposeDraftAction({ data: input })
export const aiComposeDraftAction = createServerFn({ method: "POST" })
  .validator(aiInputValidator)
  .handler(async ({ data: input }) => {
    const parsed = aiInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const data = parsed.data;
    const owned = await ownedProject(data.projectId);
    if (!owned.ok) return owned;

    const s = owned.project.settings;
    try {
      // Generation runs in the edge function using THIS project's Claude
      // credential (resolved server-side by projectId).
      const result = await invokeEdge<
        { ok: true; content: string; costUsd: number } | { ok: false; error: string }
      >("compose", {
        projectId: data.projectId,
        input: {
          topic: data.topic,
          sourceUrl: data.sourceUrl || null,
          tone: data.tone,
          customStyle: s?.customStyle ?? null,
          language: data.language,
          includeHashtags: s?.includeHashtags ?? true,
          includeSource: s?.includeSource ?? true,
          maxChars: s?.maxPostChars ?? 2200,
        },
      });
      if (!result.ok) return { ok: false as const, error: result.error };
      return { ok: true as const, content: result.content, costUsd: result.costUsd };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
