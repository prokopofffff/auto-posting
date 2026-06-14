-- Supabase-native schema for the auto-posting app.
-- Replaces the Prisma-managed migrations under prisma/migrations/*. Differences from
-- the Prisma output that matter for a DB-managed (not client-managed) setup:
--   * Every PK gets a db default (gen_random_uuid()::text) — Prisma supplied cuids client-side.
--   * Every "updatedAt" column gets a DEFAULT now() plus a BEFORE UPDATE trigger
--     (set_updated_at) — Prisma managed @updatedAt application-side.
--   * NextAuth-only tables (Account, Session, VerificationToken) and User.hashedPassword
--     are dropped; auth moves to Supabase auth.users (see madrid-9i8.6).
-- Quoted camelCase identifiers are preserved so the generated types stay camelCase
-- and app churn is minimized.

-- =====================================================================
-- Extensions
-- =====================================================================
-- gen_random_uuid() lives in pgcrypto on older Postgres; it is in core on PG13+.
-- Supabase ships it in the "extensions" schema; create defensively.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- =====================================================================
-- updatedAt trigger helper
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

-- =====================================================================
-- Enums
-- =====================================================================
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'TEAM');
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "PostMode" AS ENUM ('MANUAL', 'AUTOPILOT', 'HYBRID');
CREATE TYPE "VoiceMode" AS ENUM ('UNIFIED', 'PER_PLATFORM');
CREATE TYPE "Platform" AS ENUM ('LINKEDIN', 'TELEGRAM');
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'SKIPPED');
CREATE TYPE "FactVerdict" AS ENUM ('TRUSTED', 'CORROBORATED', 'UNVERIFIED');

-- =====================================================================
-- User (auth.js-compatible shape minus credentials; hashedPassword dropped)
-- =====================================================================
CREATE TABLE "User" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TRIGGER "User_set_updated_at" BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- Organization
-- =====================================================================
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE TRIGGER "Organization_set_updated_at" BEFORE UPDATE ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- OrganizationMember
-- =====================================================================
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "joined" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizationMember_orgId_userId_key" ON "OrganizationMember"("orgId", "userId");

-- =====================================================================
-- Project
-- =====================================================================
CREATE TABLE "Project" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PAUSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE TRIGGER "Project_set_updated_at" BEFORE UPDATE ON "Project"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- ProjectSettings
-- =====================================================================
CREATE TABLE "ProjectSettings" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "projectId" TEXT NOT NULL,
    "topics" TEXT[],
    "languages" TEXT[],
    "writingStyle" TEXT NOT NULL DEFAULT 'professional',
    "customStyle" TEXT,
    "scheduleCron" TEXT,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "preferredHour" INTEGER NOT NULL DEFAULT 9,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "mode" "PostMode" NOT NULL DEFAULT 'MANUAL',
    "includeHashtags" BOOLEAN NOT NULL DEFAULT true,
    "includeSource" BOOLEAN NOT NULL DEFAULT true,
    "maxPostChars" INTEGER NOT NULL DEFAULT 2200,
    "bannedWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moderationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "confidenceThreshold" INTEGER NOT NULL DEFAULT 80,
    "skipDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "voiceMode" "VoiceMode" NOT NULL DEFAULT 'UNIFIED',
    "voiceOverrides" JSONB,

    CONSTRAINT "ProjectSettings_pkey" PRIMARY KEY ("id")
);
-- Unique CONSTRAINT (not a bare unique index): PostgREST/Supabase only infers a
-- one-to-one embed (settings as a single object, not an array) from a real
-- unique constraint on the FK column.
ALTER TABLE "ProjectSettings" ADD CONSTRAINT "ProjectSettings_projectId_key" UNIQUE ("projectId");

-- =====================================================================
-- ConnectedAccount (OAuth tokens stored encrypted)
-- =====================================================================
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "projectId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConnectedAccount_projectId_platform_externalId_key" ON "ConnectedAccount"("projectId", "platform", "externalId");
CREATE TRIGGER "ConnectedAccount_set_updated_at" BEFORE UPDATE ON "ConnectedAccount"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- Draft (AI-generated post, pending review or scheduled)
-- =====================================================================
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "projectId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "contentByLang" JSONB NOT NULL,
    "contentByPlatform" JSONB,
    "targets" "Platform"[],
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3),
    "tokensInput" INTEGER,
    "tokensOutput" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "confidence" INTEGER,
    "factVerdict" "FactVerdict",
    "sourceTrust" DOUBLE PRECISION,
    "corroboratingSources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);
CREATE TRIGGER "Draft_set_updated_at" BEFORE UPDATE ON "Draft"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- Post (actually published record)
-- =====================================================================
CREATE TABLE "Post" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "projectId" TEXT NOT NULL,
    "draftId" TEXT,
    "platform" "Platform" NOT NULL,
    "language" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "externalUrl" TEXT,
    "externalId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "error" TEXT,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- =====================================================================
-- Foreign keys
-- =====================================================================
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectSettings" ADD CONSTRAINT "ProjectSettings_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Draft" ADD CONSTRAINT "Draft_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Post" ADD CONSTRAINT "Post_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Post" ADD CONSTRAINT "Post_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
