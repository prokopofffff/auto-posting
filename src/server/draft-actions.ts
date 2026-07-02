import { createServerFn } from "@tanstack/react-start";
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

// The validator runs on both client and server; keep it isomorphic (no
// server-only imports). Callers pass the validated shape wrapped in { data }.
function formDataValidator(data: unknown): FormData {
  if (!(data instanceof FormData)) {
    throw new Error("Expected FormData");
  }
  return data;
}

// Calling convention from a client component:
//   await approveDraftAction({ data: draftId })
// After it resolves, the caller does `await router.invalidate()` to refresh
// (replacing the old revalidatePath("/drafts") / revalidatePath("/dashboard")).
export const approveDraftAction = createServerFn({ method: "POST" })
  .validator((draftId: string) => draftId)
  .handler(async ({ data: draftId }) => {
    const owned = await assertDraftOwnership(draftId);
    if (!owned.ok) return owned;
    const res = await publishDraft(draftId);
    return res.ok
      ? { ok: true as const }
      : { ok: false as const, error: res.error };
  });

// Calling convention: await skipDraftAction({ data: draftId })
export const skipDraftAction = createServerFn({ method: "POST" })
  .validator((draftId: string) => draftId)
  .handler(async ({ data: draftId }) => {
    const owned = await assertDraftOwnership(draftId);
    if (!owned.ok) return owned;
    await unwrap(
      supabaseAdmin.from("Draft").update({ status: "SKIPPED" }).eq("id", draftId),
    );
    return { ok: true as const };
  });

// Calling convention:
//   await updateDraftContentAction({ data: { draftId, contentByLang } })
export const updateDraftContentAction = createServerFn({ method: "POST" })
  .validator(
    (input: { draftId: string; contentByLang: Record<string, string> }) => input,
  )
  .handler(async ({ data: { draftId, contentByLang } }) => {
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
    return { ok: true as const };
  });

/** Set or clear the photo attached to a draft. `imageUrl` null removes it. */
// Calling convention:
//   await updateDraftImageAction({ data: { draftId, imageUrl } })
export const updateDraftImageAction = createServerFn({ method: "POST" })
  .validator((input: { draftId: string; imageUrl: string | null }) => input)
  .handler(async ({ data: { draftId, imageUrl } }) => {
    const owned = await assertDraftOwnership(draftId);
    if (!owned.ok) return owned;
    await unwrap(
      supabaseAdmin.from("Draft").update({ imageUrl }).eq("id", draftId),
    );
    return { ok: true as const };
  });

/**
 * Upload a replacement photo for a draft and return its public URL (does not
 * attach it — the editor persists the choice via updateDraftImageAction on save).
 * Ownership is resolved from the draft's project.
 */
// Calling convention: await uploadDraftImageAction({ data: formData })
export const uploadDraftImageAction = createServerFn({ method: "POST" })
  .validator(formDataValidator)
  .handler(async ({ data: formData }) => {
    const draftId = String(formData.get("draftId") ?? "");
    if (!draftId) return { ok: false as const, error: "Missing draft." };
    const owned = await assertDraftOwnership(draftId);
    if (!owned.ok) return owned;
    return uploadProjectImage(owned.draft.projectId, formData.get("file"));
  });

/**
 * Search Google Images (via Bright Data) for a draft, keyed on its image query
 * (or topic), and return a list of candidates for the editor to show so the
 * user can pick one. Nothing is persisted or re-hosted here — that happens for
 * the chosen candidate via rehostDraftImageAction. candidates is empty if no
 * Bright Data credentials are configured or there are no results.
 */
// Calling convention: await searchDraftImagesAction({ data: draftId })
export const searchDraftImagesAction = createServerFn({ method: "POST" })
  .validator((draftId: string) => draftId)
  .handler(async ({ data: draftId }) => {
    const owned = await assertDraftOwnership(draftId);
    if (!owned.ok) return owned;
    return invokeEdge<
      { ok: true; candidates: ImageCandidate[] } | { ok: false; error: string }
    >("pick-photo", {
      projectId: owned.draft.projectId,
      draftId,
    });
  });

/**
 * Download a chosen search result and re-host it in our `post-images` bucket,
 * returning the stable public URL. Search results are arbitrary external image
 * URLs that often block hotlinking, so we always re-host the one the user picks
 * rather than linking it directly. Returns the URL without attaching it — the
 * editor stages it and saves on confirmation.
 */
// Calling convention:
//   await rehostDraftImageAction({ data: { draftId, srcUrl } })
export const rehostDraftImageAction = createServerFn({ method: "POST" })
  .validator((input: { draftId: string; srcUrl: string }) => input)
  .handler(async ({ data: { draftId, srcUrl } }) => {
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
  });

// Calling convention: await regenerateDraftAction({ data: draftId })
export const regenerateDraftAction = createServerFn({ method: "POST" })
  .validator((draftId: string) => draftId)
  .handler(async ({ data: draftId }) => {
    const owned = await assertDraftOwnership(draftId);
    if (!owned.ok) return owned;
    // The edge function reloads the draft + project and rewrites the copy against
    // the same source story; it resets status to PENDING on success.
    const res = await regenerateDraft(owned.draft.projectId, draftId);
    return res.ok
      ? { ok: true as const }
      : { ok: false as const, error: res.error };
  });

// Calling convention: await retryDraftAction({ data: draftId })
export const retryDraftAction = createServerFn({ method: "POST" })
  .validator((draftId: string) => draftId)
  .handler(async ({ data: draftId }) => {
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
    return res.ok
      ? { ok: true as const }
      : { ok: false as const, error: res.error };
  });

// Calling convention: await runNowAction({ data: projectId })
export const runNowAction = createServerFn({ method: "POST" })
  .validator((projectId: string) => projectId)
  .handler(async ({ data: projectId }) => {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Not signed in." };
    if (!(await userOwnsProject(user.id, projectId))) {
      return { ok: false as const, error: "Project not found." };
    }
    const res = await runPipelineForProject(projectId);
    if (!res.ok) return { ok: false as const, error: res.error };
    if ("skipped" in res && res.skipped)
      return { ok: true as const, skipped: true, reason: res.reason };
    return { ok: true as const, draftId: res.draftId, published: res.published };
  });
