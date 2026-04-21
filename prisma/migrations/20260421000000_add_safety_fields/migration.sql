-- AlterTable
ALTER TABLE "ProjectSettings"
  ADD COLUMN "bannedWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "moderationEnabled" BOOLEAN NOT NULL DEFAULT false;
