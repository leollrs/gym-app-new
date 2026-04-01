-- Goal Setting feature
-- Allows members to set and track fitness goals (lift PRs, body weight, workout count, etc.)

CREATE TABLE IF NOT EXISTS member_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id        UUID NOT NULL REFERENCES gyms(id),
  exercise_id   TEXT REFERENCES exercises(id),
  goal_type     TEXT NOT NULL CHECK (goal_type IN ('lift_1rm', 'body_weight', 'body_fat', 'workout_count', 'streak', 'volume')),
  target_value  NUMERIC NOT NULL,
  current_value NUMERIC NOT NULL DEFAULT 0,
  unit          TEXT,
  title         TEXT NOT NULL,
  target_date   DATE,
  achieved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (profile_id, goal_type, exercise_id)
);

-- Index for fast lookups
CREATE INDEX idx_member_goals_profile ON member_goals (profile_id);

-- RLS
ALTER TABLE member_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own goals"
  ON member_goals FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own goals"
  ON member_goals FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own goals"
  ON member_goals FOR UPDATE
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can delete own goals"
  ON member_goals FOR DELETE
  USING (auth.uid() = profile_id);
