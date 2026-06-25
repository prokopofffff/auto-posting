"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { getCurrentUser, userOwnsProject } from "@/server/project";
import { publishDraft } from "@/server/publish";
import { regenerateDraft, runPipelineForProject } from "@/server/pipeline";
import { invokeEdge } from "@/server/edge";
import { uploadProjectImage } from "@/lib/upload-image";
import type { ImageCandidate, Platform } from "@/lib/types";

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

/** Set or clear the photo attached to a draft. `imageUrl` null removes it. */
export async function updateDraftImageAction(
  draftId: string,
  imageUrl: string | null,
) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  await unwrap(
    supabaseAdmin.from("Draft").update({ imageUrl }).eq("id", draftId),
  );
  revalidatePath("/drafts");
  return { ok: true as const };
}

/**
 * Upload a replacement photo for a draft and return its public URL (does not
 * attach it — the editor persists the choice via updateDraftImageAction on save).
 * Ownership is resolved from the draft's project.
 */
export async function uploadDraftImageAction(formData: FormData) {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false as const, error: "Missing draft." };
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  return uploadProjectImage(owned.draft.projectId, formData.get("file"));
}

/**
 * Search Google Images (via Bright Data) for a draft, keyed on its image query
 * (or topic), and return a list of candidates for the editor to show so the
 * user can pick one. Nothing is persisted or re-hosted here — that happens for
 * the chosen candidate via rehostDraftImageAction. candidates is empty if no
 * Bright Data credentials are configured or there are no results.
 */
export async function searchDraftImagesAction(draftId: string) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  return invokeEdge<
    { ok: true; candidates: ImageCandidate[] } | { ok: false; error: string }
  >("pick-photo", {
    projectId: owned.draft.projectId,
    draftId,
  });
}

/**
 * Download a chosen search result and re-host it in our `post-images` bucket,
 * returning the stable public URL. Search results are arbitrary external image
 * URLs that often block hotlinking, so we always re-host the one the user picks
 * rather than linking it directly. Returns the URL without attaching it — the
 * editor stages it and saves on confirmation.
 */
export async function rehostDraftImageAction(draftId: string, srcUrl: string) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  let file: File;
  try {
    const res = await fetch(srcUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      return { ok: false as const, error: "Couldn't download that image." };
    }
    const blob = await res.blob();
    // Some hosts send "image/jpg" or no type; normalize so the uploader accepts
    // it, inferring jpeg as a last resort (the uploader re-validates the type).
    const raw = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const type = raw === "image/jpg" || raw === "" ? "image/jpeg" : raw;
    file = new File([blob], "search-image", { type });
  } catch {
    return { ok: false as const, error: "Couldn't download that image." };
  }
  return uploadProjectImage(owned.draft.projectId, file);
}

export async function regenerateDraftAction(draftId: string) {
  const owned = await assertDraftOwnership(draftId);
  if (!owned.ok) return owned;
  // The edge function reloads the draft + project and rewrites the copy against
  // the same source story; it resets status to PENDING on success.
  const res = await regenerateDraft(owned.draft.projectId, draftId);
  revalidatePath("/drafts");
  return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
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
