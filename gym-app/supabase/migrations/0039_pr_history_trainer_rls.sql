-- =============================================================
-- PR HISTORY — trainer read access
-- Migration: 0039_pr_history_trainer_rls.sql
--
-- The pr_history table only had a SELECT policy for the owning
-- member (pr_history_own). Trainers querying their clients' PRs
-- in TrainerAnalytics got empty results because RLS blocked
-- every row. This adds a trainer SELECT policy using the
-- existing is_trainer_of() helper.
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pr_history'
      AND policyname = 'pr_history_trainer_read'
  ) THEN
    CREATE POLICY "pr_history_trainer_read" ON pr_history
      FOR SELECT USING (
        public.is_trainer_of(profile_id)
      );
  END IF;
END $$;
