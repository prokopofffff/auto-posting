-- Fact-check provenance on drafts: source trust score, cross-source verdict,
-- and the list of corroborating publisher domains.

CREATE TYPE "FactVerdict" AS ENUM ('TRUSTED', 'CORROBORATED', 'UNVERIFIED');

ALTER TABLE "Draft"
  ADD COLUMN "factVerdict" "FactVerdict",
  ADD COLUMN "sourceTrust" DOUBLE PRECISION,
  ADD COLUMN "corroboratingSources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
