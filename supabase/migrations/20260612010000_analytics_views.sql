-- Aggregation helpers for the analytics + drafts surfaces.
-- supabase-js (PostgREST) has no `groupBy` / `_sum` analogue, so the two Prisma
-- aggregate call sites ported in madrid-9i8.19 are backed by DB objects here:
--   * "DraftStatusCount"   — view replacing draft.groupBy({ by: ['status'] })
--                            on the drafts page (one row per project+status).
--   * draft_spend_30d()    — rpc replacing draft.aggregate({ _sum: ... }) in
--                            analytics.ts (cost/token sums over a trailing 30d).
-- Both are read-only and keyed by projectId; tenant RLS lands in madrid-9i8.9.

-- =====================================================================
-- Draft status tallies (drafts page filter counts)
-- =====================================================================
-- One row per (projectId, status) with the row count. The page sums the
-- per-status rows into its pending/queued/shipped/failed/all buckets.
CREATE OR REPLACE VIEW "DraftStatusCount" AS
SELECT
  "projectId",
  "status",
  COUNT(*)::bigint AS "count"
FROM "Draft"
GROUP BY "projectId", "status";

-- =====================================================================
-- Draft spend over a trailing window (analytics spend KPIs)
-- =====================================================================
-- Returns the cost/token sums for drafts created in the last `p_days` days,
-- coalesced to 0 so the single-row result is always populated. Mirrors the old
-- draft.aggregate({ _sum: { costUsd, tokensInput, tokensOutput } }).
CREATE OR REPLACE FUNCTION public.draft_spend_30d(
  p_project_id TEXT,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  "costUsd" DOUBLE PRECISION,
  "tokensInput" BIGINT,
  "tokensOutput" BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(SUM("costUsd"), 0)::double precision AS "costUsd",
    COALESCE(SUM("tokensInput"), 0)::bigint AS "tokensInput",
    COALESCE(SUM("tokensOutput"), 0)::bigint AS "tokensOutput"
  FROM "Draft"
  WHERE "projectId" = p_project_id
    AND "createdAt" >= now() - make_interval(days => p_days);
$$;
