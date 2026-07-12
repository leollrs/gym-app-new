-- ============================================================
-- 0614 — member_onboarding.priority_muscles (Onboarding v2)
-- ============================================================
-- The "Your Targets" step lets a member emphasize specific muscle groups, which
-- the workout generator already biases on (workoutGenerator.js reads
-- onboarding.priority_muscles for +1 set + extra slots). The column is already
-- READ by get_trainer_client_detail (0450), but add it defensively and
-- idempotently — additive, nullable, backward-compatible, no data migration.
-- ============================================================

ALTER TABLE public.member_onboarding
  ADD COLUMN IF NOT EXISTS priority_muscles TEXT[];

COMMENT ON COLUMN public.member_onboarding.priority_muscles IS
  'Muscle groups the member chose to emphasize in onboarding (Your Targets step). Feeds the workout generator''s priority bias. NULL = no emphasis.';

NOTIFY pgrst, 'reload schema';
