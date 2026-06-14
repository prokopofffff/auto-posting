"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { getCurrentUser, userOwnsProject } from "@/server/project";

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

export async function addTopicAction(projectId: string, name: string) {
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
  revalidatePath("/topics");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function removeTopicsAction(projectId: string, names: string[]) {
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
  revalidatePath("/topics");
  revalidatePath("/dashboard");
  return { ok: true as const, removed: topics.length - next.length };
}

export async function bulkImportTopicsAction(projectId: string, raw: string) {
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
  revalidatePath("/topics");
  revalidatePath("/dashboard");
  return { ok: true as const, added: added.length };
}

