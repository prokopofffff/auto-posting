"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/project";

const MAX_TOPICS = 100;
const MAX_TOPIC_LEN = 80;

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

async function ownedSettings(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const project = await db.project.findFirst({
    where: { id: projectId, org: { members: { some: { userId: user.id } } } },
    include: { settings: true },
  });
  if (!project) return { ok: false as const, error: "Project not found." };
  if (!project.settings) {
    const created = await db.projectSettings.create({
      data: { projectId: project.id, topics: [], languages: ["en"] },
    });
    return { ok: true as const, project, settings: created };
  }
  return { ok: true as const, project, settings: project.settings };
}

export async function addTopicAction(projectId: string, name: string) {
  const owned = await ownedSettings(projectId);
  if (!owned.ok) return owned;
  const clean = normalizeName(name);
  if (!clean) return { ok: false as const, error: "Topic name is required." };
  if (clean.length > MAX_TOPIC_LEN) return { ok: false as const, error: "Topic name too long." };
  if (owned.settings.topics.includes(clean)) {
    return { ok: false as const, error: "Already in your list." };
  }
  if (owned.settings.topics.length >= MAX_TOPICS) {
    return { ok: false as const, error: `Max ${MAX_TOPICS} topics.` };
  }
  await db.projectSettings.update({
    where: { projectId },
    data: { topics: [...owned.settings.topics, clean] },
  });
  revalidatePath("/topics");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function removeTopicsAction(projectId: string, names: string[]) {
  const owned = await ownedSettings(projectId);
  if (!owned.ok) return owned;
  const drop = new Set(names);
  const next = owned.settings.topics.filter((t) => !drop.has(t));
  await db.projectSettings.update({
    where: { projectId },
    data: { topics: next },
  });
  revalidatePath("/topics");
  revalidatePath("/dashboard");
  return { ok: true as const, removed: owned.settings.topics.length - next.length };
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
  const existing = new Set(owned.settings.topics);
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
  await db.projectSettings.update({
    where: { projectId },
    data: { topics: [...owned.settings.topics, ...added] },
  });
  revalidatePath("/topics");
  revalidatePath("/dashboard");
  return { ok: true as const, added: added.length };
}

