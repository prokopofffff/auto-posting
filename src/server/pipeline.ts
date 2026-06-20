// Thin client over the `tick` Edge Function. The actual pipeline (news pick →
// Claude generation → draft → autopublish) runs in supabase/functions/tick so
// there is a single implementation reused by both the scheduler and the app.
// Callers must verify project ownership before invoking (see runNowAction).
import { invokeEdge } from "@/server/edge";

export type PipelineResult =
  | { ok: true; draftId: string; published: boolean; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export async function runPipelineForProject(
  projectId: string,
  topics?: string[],
): Promise<PipelineResult> {
  try {
    // Only send `topics` when the caller actually narrowed the run, so the
    // default scheduled behavior (all topics) is preserved by omission.
    const payload = topics && topics.length > 0 ? { projectId, topics } : { projectId };
    return await invokeEdge<PipelineResult>("generate", payload);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type RegenerateResult =
  | { ok: true; draftId: string }
  | { ok: false; error: string };

// Rewrite an existing draft's copy against the same source story (the edge
// function reuses the article fields persisted on the draft). Callers must
// verify ownership first (see regenerateDraftAction).
export async function regenerateDraft(
  projectId: string,
  draftId: string,
): Promise<RegenerateResult> {
  try {
    return await invokeEdge<RegenerateResult>("regenerate", { projectId, draftId });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// The scheduled fan-out (all due projects + flush scheduled drafts) runs
// entirely inside the edge function's default "tick" action. Exposed here for
// the manual /api/cron/tick fallback route.
export async function runTick(): Promise<unknown> {
  return invokeEdge("tick");
}
