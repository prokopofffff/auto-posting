-- Row Level Security for the tenant tables.
--
-- Why now (madrid-9i8.9): with supabase-js any cookie-bound read from a Server
-- or Client Component runs as the signed-in user against the anon key, so the
-- DB — not app code — must scope rows. The trusted paths (server actions, the
-- publishing pipeline, cron, analytics) use the service-role client from
-- src/lib/supabase/service.ts, which BYPASSES RLS entirely; these policies do
-- not touch that path, so the existing in-code tenancy checks there are
-- preserved. Only the anon/authenticated cookie-bound clients (browser.ts,
-- server.ts, middleware.ts) are governed by what follows.
--
-- Identity bridge: public."User".id is the auth.users UUID stored as text (see
-- 20260612020000_auth_user_sync.sql), so the signed-in user is `auth.uid()::text`.
--
-- The eight tenant tables fan out from org membership:
--   User                       -> the caller's own row
--   Organization               -> orgs the caller is a member of
--   OrganizationMember         -> membership rows for those same orgs
--   Project                    -> orgId in the caller's orgs
--   ProjectSettings/Connected- -> projectId belongs to one of those projects
--     Account/Draft/Post
--
-- All policies are read-scoping (FOR ALL with a membership USING clause, and a
-- matching WITH CHECK so a hypothetical cookie-bound write can't escape the
-- tenant). Mutations in practice run service-role and never evaluate these.

-- =====================================================================
-- Membership helper
-- =====================================================================
-- Returns the org ids the current user belongs to. SECURITY DEFINER so it can
-- read "OrganizationMember" without itself being filtered by that table's RLS —
-- this is what keeps the OrganizationMember policy below from recursing on
-- itself (a self-referential policy would otherwise re-invoke RLS). search_path
-- is pinned per Supabase's definer-function guidance. STABLE: same result within
-- a statement, lets the planner cache it across rows.
CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT "orgId"
  FROM "OrganizationMember"
  WHERE "userId" = (SELECT auth.uid())::text;
$$;

-- Lock the helper down: only the cookie-bound roles need it. (PUBLIC keeps
-- EXECUTE by default on functions; we leave that as-is so authenticated callers
-- can use it, matching how Supabase RLS helpers are typically granted.)

-- =====================================================================
-- Enable RLS on the eight tenant tables
-- =====================================================================
-- Once enabled, the default-deny applies to anon/authenticated; service-role
-- (and the table owner) bypass it. No FORCE ROW LEVEL SECURITY: forcing it would
-- also subject the table owner to policies, which we explicitly do not want for
-- the definer helper / future owner-run maintenance.
ALTER TABLE "User"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectSettings"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConnectedAccount"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Draft"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Post"               ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- User: own row only
-- =====================================================================
CREATE POLICY "User_self_access" ON "User"
  FOR ALL
  TO authenticated
  USING ("id" = (SELECT auth.uid())::text)
  WITH CHECK ("id" = (SELECT auth.uid())::text);

-- =====================================================================
-- Organization: orgs the caller is a member of
-- =====================================================================
CREATE POLICY "Organization_member_access" ON "Organization"
  FOR ALL
  TO authenticated
  USING ("id" IN (SELECT public.current_user_org_ids()))
  WITH CHECK ("id" IN (SELECT public.current_user_org_ids()));

-- =====================================================================
-- OrganizationMember: rows for the caller's orgs
-- =====================================================================
-- Scoped via the SECURITY DEFINER helper rather than a self-query so the policy
-- does not re-trigger RLS on this same table.
CREATE POLICY "OrganizationMember_member_access" ON "OrganizationMember"
  FOR ALL
  TO authenticated
  USING ("orgId" IN (SELECT public.current_user_org_ids()))
  WITH CHECK ("orgId" IN (SELECT public.current_user_org_ids()));

-- =====================================================================
-- Project: orgId within the caller's orgs
-- =====================================================================
CREATE POLICY "Project_member_access" ON "Project"
  FOR ALL
  TO authenticated
  USING ("orgId" IN (SELECT public.current_user_org_ids()))
  WITH CHECK ("orgId" IN (SELECT public.current_user_org_ids()));

-- =====================================================================
-- ProjectSettings / ConnectedAccount / Draft / Post: via parent Project
-- =====================================================================
-- Each child carries projectId; membership is checked by confirming that
-- project belongs to one of the caller's orgs. EXISTS against Project here is
-- itself RLS-filtered to the caller's projects, so the subquery only matches
-- rows the caller may already see.
CREATE POLICY "ProjectSettings_member_access" ON "ProjectSettings"
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "ProjectSettings"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "ProjectSettings"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ));

CREATE POLICY "ConnectedAccount_member_access" ON "ConnectedAccount"
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "ConnectedAccount"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "ConnectedAccount"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ));

CREATE POLICY "Draft_member_access" ON "Draft"
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "Draft"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "Draft"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ));

CREATE POLICY "Post_member_access" ON "Post"
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "Post"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "Post"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ));
