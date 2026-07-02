import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { getCurrentUser, getUserOrg, userOwnsProject } from "@/server/project";

const COOKIE = "am_pid";

// Validators run on BOTH client and server, so they stay isomorphic (no
// server-only imports). We deliberately do NOT enforce the Zod schemas here —
// the handlers validate and return the friendly `{ ok: false, error }` contract
// instead of throwing, matching the original Next server actions. These
// validators only pin the input type the caller must pass.
function createInputValidator(data: unknown): z.input<typeof createSchema> {
  return data as z.input<typeof createSchema>;
}

function projectIdValidator(data: unknown): string {
  if (typeof data !== "string") throw new Error("Expected a project id string");
  return data;
}

function renameInputValidator(data: unknown): z.input<typeof renameSchema> {
  return data as z.input<typeof renameSchema>;
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

// Calling convention from a client component:
//   const res = await createProjectAction({ data: { name } });
//   if (res.ok) await router.invalidate();
export const createProjectAction = createServerFn({ method: "POST" })
  .validator(createInputValidator)
  .handler(async ({ data: input }) => {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Not signed in." };
    const parsed = createSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false as const, error: "Name is required (max 80 chars)." };

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

    setCookie(COOKIE, project.id, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
    });

    // revalidatePath("/dashboard" | "/settings" | "/drafts") is now the caller's
    // job: `await router.invalidate()` after this resolves.
    return { ok: true as const, projectId: project.id };
  });

// Calling convention from a client component:
//   const res = await switchProjectAction({ data: projectId });
//   if (res.ok) await router.invalidate();
export const switchProjectAction = createServerFn({ method: "POST" })
  .validator(projectIdValidator)
  .handler(async ({ data: projectId }) => {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Not signed in." };
    if (!(await userOwnsProject(user.id, projectId))) {
      return { ok: false as const, error: "Project not found." };
    }
    setCookie(COOKIE, projectId, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
    });
    return { ok: true as const };
  });

const renameSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(80),
});

// Calling convention from a client component:
//   const res = await renameProjectAction({ data: { projectId, name } });
//   if (res.ok) await router.invalidate();
export const renameProjectAction = createServerFn({ method: "POST" })
  .validator(renameInputValidator)
  .handler(async ({ data: input }) => {
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
    return { ok: true as const };
  });

// Calling convention from a client component:
//   const res = await deleteProjectAction({ data: projectId });
// On success the server fn throws a redirect to /dashboard; on failure it
// returns `{ ok: false, error }`.
export const deleteProjectAction = createServerFn({ method: "POST" })
  .validator(projectIdValidator)
  .handler(async ({ data: projectId }) => {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Not signed in." };
    if (!(await userOwnsProject(user.id, projectId))) {
      return { ok: false as const, error: "Project not found." };
    }

    await unwrap(supabaseAdmin.from("Project").delete().eq("id", projectId));

    if (getCookie(COOKIE) === projectId) deleteCookie(COOKIE, { path: "/" });

    // redirect("/dashboard") → throw redirect({ to: "/dashboard" }).
    throw redirect({ to: "/dashboard" });
  });
