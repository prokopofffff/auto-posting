"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/project";
import { publishDraft } from "@/server/publish";
import { runPipelineForProject } from "@/server/pipeline";

async function assertDraftOwnership(draftId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const draft = await db.draft.findFirst({
    where: { id: draftId, project: { org: { members: { some: { userId: user.id } } } } },
  });
  if (!draft) return { ok: false as const, error: "Draft not found." };
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
  await db.draft.update({ where: { id: draftId }, data: { status: "SKIPPED" } });
  revalidatePath("/drafts");
  return { ok: true as const };
}

export async function updateDraftContentAction(
  draftId: string,
  contentByLang: Record<string, string>,
) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  await db.draft.update({ where: { id: draftId }, data: { contentByLang } });
  revalidatePath("/drafts");
  return { ok: true as const };
}

export async function retryDraftAction(draftId: string) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  // Wipe failed post attempts so the retry is clean.
  await db.post.deleteMany({
    where: { draftId, error: { not: null } },
  });
  // Reset to PENDING so publishDraft will accept it.
  await db.draft.update({ where: { id: draftId }, data: { status: "PENDING" } });
  const res = await publishDraft(draftId);
  revalidatePath("/drafts");
  revalidatePath("/dashboard");
  return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
}

export async function runNowAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const project = await db.project.findFirst({
    where: { id: projectId, org: { members: { some: { userId: user.id } } } },
  });
  if (!project) return { ok: false as const, error: "Project not found." };
  const res = await runPipelineForProject(projectId);
  revalidatePath("/drafts");
  revalidatePath("/dashboard");
  if (!res.ok) return { ok: false as const, error: res.error };
  if ("skipped" in res && res.skipped) return { ok: true as const, skipped: true, reason: res.reason };
  return { ok: true as const, draftId: res.draftId, published: res.published };
}
