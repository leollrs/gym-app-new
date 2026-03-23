-- Assigns a routine to a day of the week for a user's weekly schedule.
-- day_of_week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
CREATE TABLE IF NOT EXISTS workout_schedule (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  routine_id  UUID NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (profile_id, day_of_week)
);

CREATE INDEX idx_workout_schedule_profile ON workout_schedule(profile_id);

-- RLS
ALTER TABLE workout_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own schedule"
  ON workout_schedule FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Users can insert own schedule"
  ON workout_schedule FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users can update own schedule"
  ON workout_schedule FOR UPDATE
  USING (profile_id = auth.uid());

CREATE POLICY "Users can delete own schedule"
  ON workout_schedule FOR DELETE
  USING (profile_id = auth.uid());
