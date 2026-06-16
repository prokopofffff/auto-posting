-- Per-project Claude credentials (BYO API key OR Claude Max subscription).
--
-- Why this table (and not env vars): each project brings its own Claude
-- credential, so one tenant can NEVER spend another tenant's API key or Max
-- subscription. The credential is keyed 1:1 to a Project, governed by the same
-- org-membership RLS as the other tenant tables, and every server action that
-- writes it first checks `userOwnsProject`. The resolver only ever looks the
-- credential up by the project it is currently processing — there is no global
-- fallback key.
--
-- Secrets at rest: `apiKey`, `oauthAccessToken`, `oauthRefreshToken` are stored
-- AES-256-GCM encrypted (src/lib/crypto.ts ENCRYPTION_KEY) exactly like the
-- LinkedIn / Telegram tokens in ConnectedAccount. The service-role pipeline
-- (Next + Edge Function) decrypts at use time; the same ciphertext decrypts in
-- both runtimes because crypto.ts is cross-runtime.

-- API_KEY: a console.anthropic.com key.  SUBSCRIPTION: a Claude Max OAuth token
-- pair obtained via the PKCE "login with code" flow (src/lib/claude-oauth.ts).
CREATE TYPE "AiCredentialMode" AS ENUM ('API_KEY', 'SUBSCRIPTION');

CREATE TABLE "AiCredential" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "projectId" TEXT NOT NULL,
    "mode" "AiCredentialMode" NOT NULL DEFAULT 'API_KEY',
    -- All three secret columns hold AES-256-GCM ciphertext (never plaintext).
    "apiKey" TEXT,
    "oauthAccessToken" TEXT,
    "oauthRefreshToken" TEXT,
    "oauthExpiresAt" TIMESTAMP(3),
    -- NULL => the resolver picks the latest Haiku at runtime (no hard-coded id,
    -- so model launches don't require a code change).
    "model" TEXT,
    -- Audit: which user connected this credential. SET NULL on user delete so a
    -- departed user doesn't cascade-delete a still-valid project credential.
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "AiCredential_pkey" PRIMARY KEY ("id")
);

-- One credential per project (unique, not a bare index) so PostgREST infers a
-- one-to-one embed and `upsert(..., { onConflict: "projectId" })` works.
ALTER TABLE "AiCredential" ADD CONSTRAINT "AiCredential_projectId_key" UNIQUE ("projectId");

ALTER TABLE "AiCredential" ADD CONSTRAINT "AiCredential_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiCredential" ADD CONSTRAINT "AiCredential_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER "AiCredential_set_updated_at" BEFORE UPDATE ON "AiCredential"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- RLS — same org-membership scoping as the other child tables
-- (see 20260612030000_rls_tenant_isolation.sql). Cookie-bound clients are
-- governed by this; the service-role pipeline bypasses RLS and relies on the
-- in-code userOwnsProject checks. Secrets are encrypted regardless.
-- =====================================================================
ALTER TABLE "AiCredential" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AiCredential_member_access" ON "AiCredential"
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "AiCredential"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "AiCredential"."projectId"
      AND p."orgId" IN (SELECT public.current_user_org_ids())
  ));
