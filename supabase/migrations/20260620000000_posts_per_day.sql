-- Posts-per-day scheduling.
--
-- Two changes ship together here:
--  1. A new "postsPerDay" knob on ProjectSettings. The scheduler subdivides each
--     interval day into this many evenly-spaced slots (1×/day → every 24h,
--     3×/day → every 8h), so users can run more than one post per day without
--     a separate cron entry.
--  2. save_project_settings() is recreated to carry the new column. The function
--     is the single transactional writer for name + settings (see the original
--     *_save_project_settings_rpc.sql); adding the column means the INSERT and
--     the ON CONFLICT UPDATE both need the field.

ALTER TABLE "ProjectSettings"
  ADD COLUMN IF NOT EXISTS "postsPerDay" INTEGER NOT NULL DEFAULT 1;

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
    "intervalDays", "postsPerDay", "preferredHour", "timezone", "mode",
    "includeHashtags", "includeSource", "maxPostChars", "bannedWords",
    "moderationEnabled", "confidenceThreshold", "skipDays", "voiceMode",
    "voiceOverrides"
  )
  VALUES (
    p_project_id,
    ARRAY(SELECT jsonb_array_elements_text(p_settings -> 'topics')),
    ARRAY(SELECT jsonb_array_elements_text(p_settings -> 'languages')),
    p_settings ->> 'writingStyle',
    p_settings ->> 'customStyle',
    (p_settings ->> 'intervalDays')::int,
    -- Default to 1 so a payload missing the field (older client) stays valid.
    COALESCE((p_settings ->> 'postsPerDay')::int, 1),
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
    NULLIF(p_settings -> 'voiceOverrides', 'null'::jsonb)
  )
  ON CONFLICT ("projectId") DO UPDATE SET
    "topics" = EXCLUDED."topics",
    "languages" = EXCLUDED."languages",
    "writingStyle" = EXCLUDED."writingStyle",
    "customStyle" = EXCLUDED."customStyle",
    "intervalDays" = EXCLUDED."intervalDays",
    "postsPerDay" = EXCLUDED."postsPerDay",
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
