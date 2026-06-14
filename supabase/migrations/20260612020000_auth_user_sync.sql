-- Sync Supabase identities (auth.users) into the app's public."User" table.
--
-- The app keys off public."User".id (and Organization/OrganizationMember) while
-- Supabase Auth owns auth.users. A row in auth.users is the source of truth; we
-- mirror the subset the app reads (id, email, name, image, emailVerified) into
-- public."User" so the existing ~10 callers that load `user.id` keep working.
--
-- public."User".id is TEXT; auth.users.id is a UUID. We store its text form so
-- the ids line up 1:1 (the session id used by getCurrentUser() is that same
-- UUID string). The upsert-on-first-use fallback in src/server/project.ts is a
-- belt-and-suspenders backstop for rows that predate this trigger.

-- =====================================================================
-- handle_new_user: mirror an inserted/updated auth.users row into public."User"
-- =====================================================================
-- SECURITY DEFINER so the trigger (running in the auth flow) may write to
-- public."User"; search_path is pinned to keep the definer's rights from being
-- hijacked by a caller-controlled search_path. Name/image are pulled from the
-- identity's user_metadata (set by the OAuth provider or sign-up form), matching
-- the keys src/auth.ts reads (`name`, `avatar_url`).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public."User" ("id", "email", "emailVerified", "name", "image")
  VALUES (
    NEW.id::text,
    NEW.email,
    NEW.email_confirmed_at,
    COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.raw_user_meta_data ->> 'full_name'),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT ("id") DO UPDATE SET
    "email" = EXCLUDED."email",
    "emailVerified" = EXCLUDED."emailVerified",
    -- Only overwrite name/image when the new identity actually carries one, so a
    -- later confirmation/login event can't blank out values the user has set.
    "name" = COALESCE(EXCLUDED."name", public."User"."name"),
    "image" = COALESCE(EXCLUDED."image", public."User"."image");
  RETURN NEW;
END;
$$;

-- Fire on insert (sign-up) and on update (email confirmation flips
-- email_confirmed_at; email/metadata changes). Both funnel through the same
-- upsert so the public row stays in lockstep with the identity.
CREATE TRIGGER "on_auth_user_created"
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER "on_auth_user_updated"
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
