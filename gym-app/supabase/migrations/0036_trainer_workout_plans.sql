-- =============================================================
-- TRAINER WORKOUT PLANS — custom plans for individual clients
-- Migration: 0036_trainer_workout_plans.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS trainer_workout_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  trainer_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  duration_weeks SMALLINT NOT NULL DEFAULT 4,
  weeks         JSONB NOT NULL DEFAULT '{}',
  -- JSONB structure (same as gym_programs.weeks + reps & notes):
  -- { "1": [{ name: "Push Day", exercises: [{ id, sets, reps, rest_seconds, notes }] }] }
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trainer_plans_trainer ON trainer_workout_plans(trainer_id);
CREATE INDEX idx_trainer_plans_client  ON trainer_workout_plans(client_id) WHERE is_active;

ALTER TABLE trainer_workout_plans ENABLE ROW LEVEL SECURITY;

-- Trainers manage their own plans
CREATE POLICY "trainer_plans_trainer_all" ON trainer_workout_plans
  FOR ALL
  TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

-- Clients can see their plans
CREATE POLICY "trainer_plans_client_select" ON trainer_workout_plans
  FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

-- Admins can view all plans in their gym
CREATE POLICY "trainer_plans_admin_select" ON trainer_workout_plans
  FOR SELECT
  TO authenticated
  USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );
