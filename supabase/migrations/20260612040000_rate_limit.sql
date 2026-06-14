-- Durable, Postgres-backed rate limiter (madrid-9i8.12).
--
-- Replaces the process-local Map in src/lib/rate-limit.ts. On Netlify the
-- functions are ephemeral and multi-instance, so an in-memory bucket neither
-- persists across cold starts nor is shared between concurrent instances —
-- login lockout and publish backoff would effectively never trigger. This table
-- plus the rate_limit_record_failure() rpc move the window/lockout state into
-- the database so every instance sees the same counters.
--
-- All access is via the service-role client (src/lib/supabase/service.ts), which
-- bypasses RLS; the table is therefore not exposed to anon/authenticated and
-- gets no RLS policies. The rpc is the only path that mutates "attempts" and it
-- does the read-modify-write atomically (single upsert) so concurrent failures
-- from different instances cannot lose increments.

-- =====================================================================
-- Table
-- =====================================================================
-- One row per (namespace, key). "windowStart"/"lockedUntil" are epoch
-- milliseconds (BIGINT) to mirror the Date.now() arithmetic the callers already
-- use, so the app keeps doing millisecond math without timestamp conversions.
CREATE TABLE "RateLimit" (
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStart" BIGINT NOT NULL,
    "lockedUntil" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("namespace", "key")
);
-- Lets the periodic prune (and any maintenance) scan stale rows cheaply.
CREATE INDEX "RateLimit_lockedUntil_idx" ON "RateLimit"("lockedUntil");

-- Locked down: only the service role touches this table. No grants to anon /
-- authenticated, and (belt-and-braces) RLS on with no policies so a cookie-bound
-- client can never read another user's attempt counters.
ALTER TABLE "RateLimit" ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- Atomic failure record
-- =====================================================================
-- Increments the attempt counter for (p_namespace, p_key) and arms the lockout
-- when the threshold is reached, returning the row's resulting "lockedUntil".
-- The whole read-modify-write is one INSERT ... ON CONFLICT so two instances
-- racing on the same key can't both read attempts=N and each write N+1.
--
-- Window reset: if the existing row's window has elapsed (now - windowStart >
-- p_window_ms) the counter restarts from this failure, matching the old
-- in-memory semantics. p_now is passed in (epoch ms) so the rpc shares the
-- caller's clock rather than relying on the db clock.
CREATE OR REPLACE FUNCTION public.rate_limit_record_failure(
  p_namespace  TEXT,
  p_key        TEXT,
  p_now        BIGINT,
  p_window_ms  BIGINT,
  p_max_attempts INTEGER,
  p_lockout_ms BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_until BIGINT;
BEGIN
  INSERT INTO "RateLimit" AS rl ("namespace", "key", "attempts", "windowStart", "lockedUntil")
  VALUES (p_namespace, p_key, 1, p_now, 0)
  ON CONFLICT ("namespace", "key") DO UPDATE
    SET
      -- restart the window (attempts -> 1) when it has elapsed, else increment
      "attempts" = CASE
        WHEN p_now - rl."windowStart" > p_window_ms THEN 1
        ELSE rl."attempts" + 1
      END,
      "windowStart" = CASE
        WHEN p_now - rl."windowStart" > p_window_ms THEN p_now
        ELSE rl."windowStart"
      END
  RETURNING "attempts" INTO v_locked_until; -- temporarily holds attempts

  -- Arm the lockout once the (possibly reset) counter hits the threshold.
  IF v_locked_until >= p_max_attempts THEN
    UPDATE "RateLimit"
      SET "lockedUntil" = p_now + p_lockout_ms
      WHERE "namespace" = p_namespace AND "key" = p_key
      RETURNING "lockedUntil" INTO v_locked_until;
  ELSE
    v_locked_until := 0;
  END IF;

  RETURN v_locked_until;
END;
$$;
