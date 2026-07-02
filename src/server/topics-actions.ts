import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { getCurrentUser, userOwnsProject } from "@/server/project";
import { runPipelineForProject } from "@/server/pipeline";

const MAX_TOPICS = 100;
const MAX_TOPIC_LEN = 80;

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

async function ownedSettings(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!(await userOwnsProject(user.id, projectId))) {
    return { ok: false as const, error: "Project not found." };
  }
  const { data: settings } = await supabaseAdmin
    .from("ProjectSettings")
    .select("*")
    .eq("projectId", projectId)
    .maybeSingle();
  if (!settings) {
    const created = await unwrap(
      supabaseAdmin
        .from("ProjectSettings")
        .insert({ projectId, topics: [], languages: ["en"] })
        .select()
        .single(),
    );
    return { ok: true as const, settings: created };
  }
  return { ok: true as const, settings };
}

// Calling convention from a client component:
//   await addTopicAction({ data: { projectId, name } })
// revalidatePath is gone: the client calls `await router.invalidate()` after
// this resolves to refresh the /topics and /dashboard loaders.
export const addTopicAction = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: z.string(), name: z.string() }))
  .handler(async ({ data: { projectId, name } }) => {
    const owned = await ownedSettings(projectId);
    if (!owned.ok) return owned;
    const clean = normalizeName(name);
    if (!clean) return { ok: false as const, error: "Topic name is required." };
    if (clean.length > MAX_TOPIC_LEN) return { ok: false as const, error: "Topic name too long." };
    const topics = owned.settings.topics ?? [];
    if (topics.includes(clean)) {
      return { ok: false as const, error: "Already in your list." };
    }
    if (topics.length >= MAX_TOPICS) {
      return { ok: false as const, error: `Max ${MAX_TOPICS} topics.` };
    }
    await unwrap(
      supabaseAdmin
        .from("ProjectSettings")
        .update({ topics: [...topics, clean] })
        .eq("projectId", projectId),
    );
    return { ok: true as const };
  });

// Calling convention from a client component:
//   await removeTopicsAction({ data: { projectId, names } })
export const removeTopicsAction = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: z.string(), names: z.array(z.string()) }))
  .handler(async ({ data: { projectId, names } }) => {
    const owned = await ownedSettings(projectId);
    if (!owned.ok) return owned;
    const drop = new Set(names);
    const topics = owned.settings.topics ?? [];
    const next = topics.filter((t) => !drop.has(t));
    await unwrap(
      supabaseAdmin
        .from("ProjectSettings")
        .update({ topics: next })
        .eq("projectId", projectId),
    );
    return { ok: true as const, removed: topics.length - next.length };
  });

/**
 * Generate a draft now for a specific set of topics the user picked, instead of
 * waiting for the scheduled run to choose across all topics. Verifies ownership,
 * then reuses the same edge pipeline as the scheduler (with a topic override).
 *
 * Calling convention from a client component:
 *   await generateForTopicsAction({ data: { projectId, topics } })
 */
export const generateForTopicsAction = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: z.string(), topics: z.array(z.string()) }))
  .handler(async ({ data: { projectId, topics } }) => {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Not signed in." };
    if (!(await userOwnsProject(user.id, projectId))) {
      return { ok: false as const, error: "Project not found." };
    }
    const picked = Array.from(new Set(topics.map((t) => t.trim()).filter(Boolean)));
    if (picked.length === 0) return { ok: false as const, error: "Pick at least one topic." };

    const res = await runPipelineForProject(projectId, picked);
    if (!res.ok) return { ok: false as const, error: res.error };
    if ("skipped" in res && res.skipped) {
      return { ok: true as const, skipped: true, reason: res.reason };
    }
    return { ok: true as const, draftId: res.draftId, published: res.published };
  });

// Calling convention from a client component:
//   await bulkImportTopicsAction({ data: { projectId, raw } })
export const bulkImportTopicsAction = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: z.string(), raw: z.string() }))
  .handler(async ({ data: { projectId, raw } }) => {
    const owned = await ownedSettings(projectId);
    if (!owned.ok) return owned;
    const lines = raw
      .split("\n")
      .map((l) => normalizeName(l.split(",")[0] ?? ""))
      .filter(Boolean)
      .filter((l) => l.length <= MAX_TOPIC_LEN);
    if (lines.length === 0) {
      return { ok: false as const, error: "No valid topics in input." };
    }
    const topics = owned.settings.topics ?? [];
    const existing = new Set(topics);
    const added: string[] = [];
    for (const l of lines) {
      if (existing.has(l)) continue;
      if (existing.size >= MAX_TOPICS) break;
      added.push(l);
      existing.add(l);
    }
    if (added.length === 0) {
      return { ok: false as const, error: "All topics already in your list." };
    }
    await unwrap(
      supabaseAdmin
        .from("ProjectSettings")
        .update({ topics: [...topics, ...added] })
        .eq("projectId", projectId),
    );
    return { ok: true as const, added: added.length };
  });
