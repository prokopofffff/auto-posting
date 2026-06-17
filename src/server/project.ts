import { cache } from "react";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase/service";
import { selectProjectWithRelations, unwrap } from "@/lib/supabase/queries";

const COOKIE = "am_pid";

// Reads the Supabase session, then returns the matching public.User row (the
// same shape the old Prisma `db.user.findUnique` returned, so the ~10 callers
// that key off `user.id` keep working). The service-role client is used to read
// the row because tenant RLS is not in place yet (madrid-9i8.9); the id comes
// from the verified session, so this is not a tenancy bypass.
//
// The auth.users -> public.User sync is normally handled by the DB trigger
// (supabase/migrations/*_auth_user_sync.sql). This upsert-on-first-use is the
// backstop for identities that predate the trigger (e.g. users migrated into
// auth.users before it was installed): the session is already verified by
// supabase.auth.getUser(), so seeding the public row from it is safe.
export const getCurrentUser = cache(async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const { data } = await supabaseAdmin
    .from("User")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();
  if (data) return data;

  // No mirror row yet — create it from the verified session. `onConflict: "id"`
  // makes this idempotent against a concurrent trigger insert; email is required
  // by the schema, so bail (returning null) if the session has none.
  if (!session.user.email) return null;
  return unwrap(
    supabaseAdmin
      .from("User")
      .upsert(
        {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name ?? null,
          image: session.user.image ?? null,
        },
        { onConflict: "id" },
      )
      .select()
      .single(),
  );
});

// `cache()` dedupes per request: the app layout and the page both call
// ensureOrg/getCurrentProject while rendering, and without this each concurrent
// call would independently hit the "no project yet" branch and create its own
// "My first project" — producing duplicate projects on a fresh account.
// Return the user's first org id, creating an org + OWNER membership on first
// use. Not cache-wrapped (it writes); `getCurrentProject` calls the cached
// `ensureOrg` wrapper below for per-request dedupe. Also used by the project
// server actions.
export async function getUserOrg(userId: string): Promise<string> {
  const { data: m } = await supabaseAdmin
    .from("OrganizationMember")
    .select("orgId")
    .eq("userId", userId)
    .order("joined", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (m) return m.orgId;

  const { data: user } = await supabaseAdmin
    .from("User")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  const org = await unwrap(
    supabaseAdmin
      .from("Organization")
      .insert({
        name: user?.name ? `${user.name}'s workspace` : "My workspace",
        ownerId: userId,
      })
      .select()
      .single(),
  );
  await unwrap(
    supabaseAdmin
      .from("OrganizationMember")
      .insert({ orgId: org.id, userId, role: "OWNER" }),
  );
  return org.id;
}

const ensureOrg = cache(getUserOrg);

// Resolve the org ids this user belongs to, used to scope project queries
// (the supabase-js analogue of the old `org: { members: { some: { userId } } }`
// relation filter, which has no single-query form in PostgREST here).
async function userOrgIds(userId: string): Promise<string[]> {
  const rows = await unwrap(
    supabaseAdmin
      .from("OrganizationMember")
      .select("orgId")
      .eq("userId", userId),
  );
  return rows.map((r) => r.orgId);
}

// True when `projectId` belongs to one of the user's orgs. Replaces the repeated
// Prisma `project.findFirst({ where: { id, org: { members: { some: { userId } } } } })`
// ownership guard, which has no single-query PostgREST form here.
export async function userOwnsProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const orgIds = await userOrgIds(userId);
  if (orgIds.length === 0) return false;
  const { data } = await supabaseAdmin
    .from("Project")
    .select("id")
    .eq("id", projectId)
    .in("orgId", orgIds)
    .maybeSingle();
  return !!data;
}

export async function listUserProjects(userId: string) {
  const orgIds = await userOrgIds(userId);
  if (orgIds.length === 0) return [];
  return unwrap(
    supabaseAdmin
      .from("Project")
      .select("id, name, status, orgId")
      .in("orgId", orgIds)
      .order("createdAt", { ascending: true }),
  );
}

export const getCurrentProject = cache(async function getCurrentProject(
  userId: string,
) {
  const orgId = await ensureOrg(userId);
  const orgIds = await userOrgIds(userId);
  const c = await cookies();
  const pid = c.get(COOKIE)?.value;

  if (pid) {
    const { data: found } = await selectProjectWithRelations(supabaseAdmin, pid);
    // Enforce membership: the cookie pid must belong to one of the user's orgs.
    if (found && orgIds.includes(found.orgId)) return found;
  }

  const { data: first } = await supabaseAdmin
    .from("Project")
    .select("*, settings:ProjectSettings(*), connectedAccounts:ConnectedAccount(*)")
    .eq("orgId", orgId)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (first) return first;

  // No project yet — create one with its default settings. Prisma's nested
  // `settings.create` becomes two inserts (project, then its settings row); we
  // compose the relation graph from both returned rows rather than re-fetching
  // it, since a freshly created project has exactly these settings and no
  // connected accounts.
  const created = await unwrap(
    supabaseAdmin
      .from("Project")
      .insert({ orgId, name: "My first project" })
      .select()
      .single(),
  );
  const settings = await unwrap(
    supabaseAdmin
      .from("ProjectSettings")
      .insert({
        projectId: created.id,
        topics: ["tech", "ai"],
        languages: ["en"],
        writingStyle: "professional",
      })
      .select()
      .single(),
  );
  return { ...created, settings, connectedAccounts: [] };
});

// Back-compat alias so existing callers keep working.
export const getOrCreateDefaultProject = getCurrentProject;
