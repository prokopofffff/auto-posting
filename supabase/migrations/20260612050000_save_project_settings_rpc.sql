-- Atomic save of a project's name + settings.
--
-- saveSettingsAction() updates "Project".name and upserts "ProjectSettings".
-- Over PostgREST those are two separate round-trips with no enclosing
-- transaction, so a failure between them could persist the name without the
-- settings (or leave them inconsistent). A plpgsql function runs in a single
-- implicit transaction, so wrapping both writes here makes them commit or roll
-- back together.
--
-- p_settings carries the "ProjectSettings" columns (minus projectId) as JSON --
-- the same object the action previously passed to .upsert(); each field is cast
-- back to its column type below. The caller is the service-role client; EXECUTE
-- is revoked from anon/authenticated so this can't be invoked from the client.
CREATE OR REPLACE FUNCTION public.save_project_settings(
  p_project_id text,
  p_name text,
  p_settings jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public."Project"
     SET "name" = p_name
   WHERE "id" = p_project_id;

  INSERT INTO public."ProjectSettings" (
    "projectId", "topics", "languages", "writingStyle", "customStyle",
    "intervalDays", "preferredHour", "timezone", "mode", "includeHashtags",
    "includeSource", "maxPostChars", "bannedWords", "moderationEnabled",
    "confidenceThreshold", "skipDays", "voiceMode", "voiceOverrides"
  )
  VALUES (
    p_project_id,
    ARRAY(SELECT jsonb_array_elements_text(p_settings -> 'topics')),
    ARRAY(SELECT jsonb_array_elements_text(p_settings -> 'languages')),
    p_settings ->> 'writingStyle',
    p_settings ->> 'customStyle',
    (p_settings ->> 'intervalDays')::int,
    (p_settings ->> 'preferredHour')::int,
    p_settings ->> 'timezone',
    (p_settings ->> 'mode')::public."PostMode",
    (p_settings ->> 'includeHashtags')::boolean,
    (p_settings ->> 'includeSource')::boolean,
    (p_settings ->> 'maxPostChars')::int,
    ARRAY(SELECT jsonb_array_elements_text(p_settings -> 'bannedWords')),
    (p_settings ->> 'moderationEnabled')::boolean,
    (p_settings ->> 'confidenceThreshold')::int,
    ARRAY(SELECT jsonb_array_elements_text(p_settings -> 'skipDays'))::int[],
    (p_settings ->> 'voiceMode')::public."VoiceMode",
    -- A JSON `null` for voiceOverrides becomes a SQL NULL (not jsonb 'null'),
    -- matching the prior upsert which passed JS null straight through.
    NULLIF(p_settings -> 'voiceOverrides', 'null'::jsonb)
  )
  ON CONFLICT ("projectId") DO UPDATE SET
    "topics" = EXCLUDED."topics",
    "languages" = EXCLUDED."languages",
    "writingStyle" = EXCLUDED."writingStyle",
    "customStyle" = EXCLUDED."customStyle",
    "intervalDays" = EXCLUDED."intervalDays",
    "preferredHour" = EXCLUDED."preferredHour",
    "timezone" = EXCLUDED."timezone",
    "mode" = EXCLUDED."mode",
    "includeHashtags" = EXCLUDED."includeHashtags",
    "includeSource" = EXCLUDED."includeSource",
    "maxPostChars" = EXCLUDED."maxPostChars",
    "bannedWords" = EXCLUDED."bannedWords",
    "moderationEnabled" = EXCLUDED."moderationEnabled",
    "confidenceThreshold" = EXCLUDED."confidenceThreshold",
    "skipDays" = EXCLUDED."skipDays",
    "voiceMode" = EXCLUDED."voiceMode",
    "voiceOverrides" = EXCLUDED."voiceOverrides";
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_project_settings(text, text, jsonb)
  FROM anon, authenticated;
