import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { auth } from "@/auth";

const COOKIE = "am_pid";

export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.user.findUnique({ where: { id: session.user.id } });
}

// `cache()` dedupes per request: the app layout and the page both call
// ensureOrg/getCurrentProject while rendering, and without this each concurrent
// call would independently hit the "no project yet" branch and create its own
// "My first project" — producing duplicate projects on a fresh account.
const ensureOrg = cache(async function ensureOrg(userId: string): Promise<string> {
  const m = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { joined: "asc" },
  });
  if (m) return m.orgId;
  const user = await db.user.findUnique({ where: { id: userId } });
  const org = await db.organization.create({
    data: { name: user?.name ? `${user.name}'s workspace` : "My workspace", ownerId: userId },
  });
  await db.organizationMember.create({ data: { orgId: org.id, userId, role: "OWNER" } });
  return org.id;
});

export async function listUserProjects(userId: string) {
  return db.project.findMany({
    where: { org: { members: { some: { userId } } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true, orgId: true },
  });
}

export const getCurrentProject = cache(async function getCurrentProject(
  userId: string,
) {
  const orgId = await ensureOrg(userId);
  const c = await cookies();
  const pid = c.get(COOKIE)?.value;

  if (pid) {
    const found = await db.project.findFirst({
      where: { id: pid, org: { members: { some: { userId } } } },
      include: { settings: true, connectedAccounts: true },
    });
    if (found) return found;
  }

  const first = await db.project.findFirst({
    where: { orgId },
    include: { settings: true, connectedAccounts: true },
    orderBy: { createdAt: "asc" },
  });
  if (first) return first;

  return db.project.create({
    data: {
      orgId,
      name: "My first project",
      settings: {
        create: { topics: ["tech", "ai"], languages: ["en"], writingStyle: "professional" },
      },
    },
    include: { settings: true, connectedAccounts: true },
  });
});

// Back-compat alias so existing callers keep working.
export const getOrCreateDefaultProject = getCurrentProject;
