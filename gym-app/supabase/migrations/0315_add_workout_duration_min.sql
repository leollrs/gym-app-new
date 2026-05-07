-- Add workout duration preference to member_onboarding
ALTER TABLE member_onboarding
  ADD COLUMN IF NOT EXISTS workout_duration_min INTEGER DEFAULT 60;

COMMENT ON COLUMN member_onboarding.workout_duration_min
  IS 'Preferred workout session length in minutes (30/45/60/90). Influences generated program volume.';
