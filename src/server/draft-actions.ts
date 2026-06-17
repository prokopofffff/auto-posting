"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { getCurrentUser, userOwnsProject } from "@/server/project";
import { publishDraft } from "@/server/publish";
import { runPipelineForProject } from "@/server/pipeline";
import type { Platform } from "@/lib/types";

async function assertDraftOwnership(draftId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const { data: draft } = await supabaseAdmin
    .from("Draft")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft || !(await userOwnsProject(user.id, draft.projectId))) {
    return { ok: false as const, error: "Draft not found." };
  }
  return { ok: true as const, draft };
}

export async function approveDraftAction(draftId: string) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  const res = await publishDraft(draftId);
  revalidatePath("/drafts");
  revalidatePath("/dashboard");
  return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
}

export async function skipDraftAction(draftId: string) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  await unwrap(
    supabaseAdmin.from("Draft").update({ status: "SKIPPED" }).eq("id", draftId),
  );
  revalidatePath("/drafts");
  return { ok: true as const };
}

export async function updateDraftContentAction(
  draftId: string,
  contentByLang: Record<string, string>,
) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  // User edits become authoritative — clear per-platform overrides so publish uses the edited text.
  // A SQL JSON null is just `null` (no Prisma.JsonNull).
  await unwrap(
    supabaseAdmin
      .from("Draft")
      .update({ contentByLang, contentByPlatform: null })
      .eq("id", draftId),
  );
  revalidatePath("/drafts");
  return { ok: true as const };
}

export async function retryDraftAction(draftId: string) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  // Platforms that already shipped successfully — skip them on the retry so a
  // partial failure (one platform errored, another succeeded) doesn't double-post.
  const existing = await unwrap(
    supabaseAdmin.from("Post").select("platform, error").eq("draftId", draftId),
  );
  const succeeded = [
    ...new Set(
      existing.filter((p) => !p.error).map((p) => p.platform as Platform),
    ),
  ];
  // Wipe failed post attempts so the retry is clean.
  await unwrap(
    supabaseAdmin
      .from("Post")
      .delete()
      .eq("draftId", draftId)
      .not("error", "is", null),
  );
  // Reset to PENDING so publishDraft will accept it.
  await unwrap(
    supabaseAdmin.from("Draft").update({ status: "PENDING" }).eq("id", draftId),
  );
  const res = await publishDraft(draftId, { skipPlatforms: succeeded });
  revalidatePath("/drafts");
  revalidatePath("/dashboard");
  return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
}

export async function runNowAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!(await userOwnsProject(user.id, projectId))) {
    return { ok: false as const, error: "Project not found." };
  }
  const res = await runPipelineForProject(projectId);
  revalidatePath("/drafts");
  revalidatePath("/dashboard");
  if (!res.ok) return { ok: false as const, error: res.error };
  if ("skipped" in res && res.skipped) return { ok: true as const, skipped: true, reason: res.reason };
  return { ok: true as const, draftId: res.draftId, published: res.published };
}
