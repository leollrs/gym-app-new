-- =============================================================
-- DROP LEGACY v1/v2 CHURN SCORER + PURGE ITS STALE ROWS
-- Migration: 0510_drop_legacy_churn_scorer.sql
--
-- The SQL function public.compute_churn_scores(uuid) (created in 0079, re-created
-- in 0471) is the OLD churn model. It stamps every member with no logged workout
-- as score 95 / "Never logged a workout" — the exact cold-start over-flagging the
-- v3 model fixes. It's fully superseded by:
--   • the compute-churn-scores EDGE function (nightly precompute, scheduled in
--     0033 via pg_cron → pg_net; that cron calls the EDGE fn, NOT this SQL fn), and
--   • the client live engine (src/lib/churn/retention.js) which recomputes on read.
--
-- Its only callers were AdminChurn.jsx + AdminOverview.jsx auto-running it on mount
-- (removed in the frontend). No cron job / trigger / other function references it,
-- so dropping it is safe and stops it from "creeping back" via a stray client call.
--
-- 0508/0509 were additive (added columns) and never deleted the rows this scorer
-- already wrote, so the stale 95-scores persisted. This migration purges them too.
-- churn_risk_scores is a recomputable cache — the edge fn / live engine repopulate it.
-- =============================================================

-- 1. Drop the legacy scorer (single signature: compute_churn_scores(uuid)).
DROP FUNCTION IF EXISTS public.compute_churn_scores(uuid);

-- 2. Purge the stale v1/v2 score rows it wrote. v3 rows carry primary_driver;
--    legacy rows have it NULL. Guarded in case 0508 (which adds the column) is
--    applied out of order — then every row is legacy and gets cleared.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'churn_risk_scores'
      AND column_name = 'primary_driver'
  ) THEN
    DELETE FROM public.churn_risk_scores WHERE primary_driver IS NULL;
  ELSE
    DELETE FROM public.churn_risk_scores;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
