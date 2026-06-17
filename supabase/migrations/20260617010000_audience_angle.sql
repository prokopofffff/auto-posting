-- Audience + angle: who each project writes for, and the lens to frame stories
-- through. These feed two places:
--   1. The relevance gate in the tick pipeline (an article irrelevant to the
--      audience is skipped instead of posted), and
--   2. The generation system prompt (posts are written from the audience's
--      perspective, e.g. fintech-for-developers vs fintech-for-economists).
-- Both are free-text and nullable; empty means "no audience steer" (prior
-- behaviour).
ALTER TABLE "ProjectSettings"
  ADD COLUMN IF NOT EXISTS "audience" TEXT,
  ADD COLUMN IF NOT EXISTS "angle" TEXT;

-- save_project_settings must carry the two new fields through the same atomic
-- upsert as the rest of the settings. CREATE OR REPLACE keeps the existing
-- transaction semantics; only the audience/angle lines are new.
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
    "confidenceThreshold", "skipDays", "voiceMode", "voiceOverrides",
    "audience", "angle"
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
    NULLIF(p_settings -> 'voiceOverrides', 'null'::jsonb),
    p_settings ->> 'audience',
    p_settings ->> 'angle'
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
    "voiceOverrides" = EXCLUDED."voiceOverrides",
    "audience" = EXCLUDED."audience",
    "angle" = EXCLUDED."angle";
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_project_settings(text, text, jsonb)
  FROM anon, authenticated;
