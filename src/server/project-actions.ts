"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/project";

const COOKIE = "am_pid";

async function getUserOrg(userId: string) {
  const m = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { joined: "asc" },
  });
  if (m) return m.orgId;
  const user = await db.user.findUnique({ where: { id: userId } });
  const org = await db.organization.create({
    data: { name: user?.name ? `${user.name}'s workspace` : "My workspace", ownerId: userId },
  });
  await db.organizationMember.create({
    data: { orgId: org.id, userId, role: "OWNER" },
  });
  return org.id;
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

export async function createProjectAction(input: z.input<typeof createSchema>) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Name is required (max 80 chars)." };

  const orgId = await getUserOrg(user.id);
  const project = await db.project.create({
    data: {
      orgId,
      name: parsed.data.name,
      settings: {
        create: { topics: ["tech", "ai"], languages: ["en"], writingStyle: "professional" },
      },
    },
  });

  const c = await cookies();
  c.set(COOKIE, project.id, { path: "/", httpOnly: false, sameSite: "lax" });

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/drafts");
  return { ok: true as const, projectId: project.id };
}

export async function switchProjectAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const project = await db.project.findFirst({
    where: { id: projectId, org: { members: { some: { userId: user.id } } } },
  });
  if (!project) return { ok: false as const, error: "Project not found." };
  const c = await cookies();
  c.set(COOKIE, project.id, { path: "/", httpOnly: false, sameSite: "lax" });
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/drafts");
  return { ok: true as const };
}

const renameSchema = z.object({ projectId: z.string().min(1), name: z.string().min(1).max(80) });

export async function renameProjectAction(input: z.input<typeof renameSchema>) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input." };
  const project = await db.project.findFirst({
    where: { id: parsed.data.projectId, org: { members: { some: { userId: user.id } } } },
  });
  if (!project) return { ok: false as const, error: "Project not found." };
  await db.project.update({ where: { id: project.id }, data: { name: parsed.data.name } });
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function deleteProjectAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const project = await db.project.findFirst({
    where: { id: projectId, org: { members: { some: { userId: user.id } } } },
  });
  if (!project) return { ok: false as const, error: "Project not found." };

  await db.project.delete({ where: { id: project.id } });

  const c = await cookies();
  if (c.get(COOKIE)?.value === projectId) c.delete(COOKIE);

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/drafts");
  redirect("/dashboard");
}
