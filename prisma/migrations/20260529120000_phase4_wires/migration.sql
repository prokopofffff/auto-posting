-- Phase 4 wires: per-platform voice, hybrid mode, skip days, generation telemetry.

-- Enums
ALTER TYPE "PostMode" ADD VALUE IF NOT EXISTS 'HYBRID';

CREATE TYPE "VoiceMode" AS ENUM ('UNIFIED', 'PER_PLATFORM');

-- ProjectSettings
ALTER TABLE "ProjectSettings"
  ADD COLUMN "confidenceThreshold" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN "skipDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "voiceMode" "VoiceMode" NOT NULL DEFAULT 'UNIFIED',
  ADD COLUMN "voiceOverrides" JSONB;

-- Draft
ALTER TABLE "Draft"
  ADD COLUMN "contentByPlatform" JSONB,
  ADD COLUMN "tokensInput" INTEGER,
  ADD COLUMN "tokensOutput" INTEGER,
  ADD COLUMN "costUsd" DOUBLE PRECISION,
  ADD COLUMN "confidence" INTEGER;
