-- Drafts now record the FULL set of topics a story sits at the intersection of,
-- not just the single best-matching one. `topic` stays as the primary label
-- (the most central match) for existing consumers (analytics, dashboard);
-- `topics` holds the complete intersection set used for picking and shown in the
-- Drafts UI.
ALTER TABLE "Draft"
  ADD COLUMN "topics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill existing drafts so they expose at least their single topic.
UPDATE "Draft"
  SET "topics" = ARRAY["topic"]
  WHERE "topic" IS NOT NULL AND "topic" <> '';
