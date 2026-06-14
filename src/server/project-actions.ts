"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { getCurrentUser, getUserOrg, userOwnsProject } from "@/server/project";

const COOKIE = "am_pid";

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

export async function createProjectAction(input: z.input<typeof createSchema>) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Name is required (max 80 chars)." };

  const orgId = await getUserOrg(user.id);
  // Prisma's nested `settings.create` becomes two inserts (project, then settings).
  const project = await unwrap(
    supabaseAdmin
      .from("Project")
      .insert({ orgId, name: parsed.data.name })
      .select()
      .single(),
  );
  await unwrap(
    supabaseAdmin.from("ProjectSettings").insert({
      projectId: project.id,
      topics: ["tech", "ai"],
      languages: ["en"],
      writingStyle: "professional",
    }),
  );

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
  if (!(await userOwnsProject(user.id, projectId))) {
    return { ok: false as const, error: "Project not found." };
  }
  const c = await cookies();
  c.set(COOKIE, projectId, { path: "/", httpOnly: false, sameSite: "lax" });
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
  if (!(await userOwnsProject(user.id, parsed.data.projectId))) {
    return { ok: false as const, error: "Project not found." };
  }
  await unwrap(
    supabaseAdmin
      .from("Project")
      .update({ name: parsed.data.name })
      .eq("id", parsed.data.projectId),
  );
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { ok: true as const };
}

export async function deleteProjectAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  if (!(await userOwnsProject(user.id, projectId))) {
    return { ok: false as const, error: "Project not found." };
  }

  await unwrap(supabaseAdmin.from("Project").delete().eq("id", projectId));

  const c = await cookies();
  if (c.get(COOKIE)?.value === projectId) c.delete(COOKIE);

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/drafts");
  redirect("/dashboard");
}
