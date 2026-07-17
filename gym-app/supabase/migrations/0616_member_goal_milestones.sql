-- ============================================================
-- 0616 — member_goals milestones (Onboarding v2)
-- ============================================================
-- A big goal (e.g. 120 → 160 lb) gets a near-term ~12-week MILESTONE so there's
-- a proximal win to celebrate while the long-term target stays active. Both are
-- real member_goals rows so they get progress bars + the achieved-notification
-- for free — but the existing UNIQUE(profile_id, goal_type, exercise_id) blocks
-- two same-type goals for LIFT goals (exercise_id NOT NULL). (Body goals had
-- exercise_id = NULL, which Postgres already treats as distinct, so those never
-- collided — but we include is_milestone in the key for consistency.)
--
--   is_milestone   — TRUE for the near-term chunk; FALSE for the real target.
--   parent_goal_id — milestone → its long-term goal (CASCADE: deleting the
--                    long-term goal removes its milestone). Completing a
--                    milestone does NOT complete the parent — they're independent
--                    rows with independent target_values, so goalUpdater marks
--                    only the one whose target the reading actually reached.
-- ============================================================

ALTER TABLE public.member_goals
  ADD COLUMN IF NOT EXISTS is_milestone   BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.member_goals
  ADD COLUMN IF NOT EXISTS parent_goal_id UUID REFERENCES public.member_goals(id) ON DELETE CASCADE;

-- Replace the (profile_id, goal_type, exercise_id) unique constraint with one
-- that also keys on is_milestone, so a lift milestone can coexist with the lift
-- long-term goal. Drop by lookup (the 0122 inline constraint is auto-named).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'public.member_goals'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) LIKE '%(profile_id, goal_type, exercise_id)%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.member_goals DROP CONSTRAINT ' || quote_ident(c);
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.member_goals
    ADD CONSTRAINT member_goals_profile_type_exercise_milestone_key
    UNIQUE (profile_id, goal_type, exercise_id, is_milestone);
EXCEPTION WHEN duplicate_table THEN NULL;  -- already added (idempotent re-run)
END $$;

CREATE INDEX IF NOT EXISTS idx_member_goals_parent ON public.member_goals (parent_goal_id)
  WHERE parent_goal_id IS NOT NULL;

COMMENT ON COLUMN public.member_goals.is_milestone IS
  'TRUE = near-term milestone chunk of a bigger goal; FALSE = the real long-term target.';
COMMENT ON COLUMN public.member_goals.parent_goal_id IS
  'Milestone → its long-term goal. Completing the milestone never completes the parent.';

NOTIFY pgrst, 'reload schema';
