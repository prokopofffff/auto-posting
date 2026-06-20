-- Persist the source article's summary/excerpt on the Draft.
--
-- Drafts already store the article URL + title, but not the body text the model
-- was given. Keeping the excerpt lets "regenerate" re-run generation against the
-- same story faithfully (instead of writing from the headline alone), and gives
-- the dedup/seen logic a richer record of what we've already covered.
ALTER TABLE "Draft"
  ADD COLUMN IF NOT EXISTS "sourceExcerpt" TEXT;
