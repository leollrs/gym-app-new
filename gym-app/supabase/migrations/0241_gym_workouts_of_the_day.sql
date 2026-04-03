-- Gym-wide Workout of the Day table
-- Each gym gets one auto-generated WOD per day, visible to all members.

CREATE TABLE IF NOT EXISTS gym_workouts_of_the_day (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id           UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  workout_data     JSONB NOT NULL,        -- { exercises: [{ exerciseId, sets, reps, restSeconds }], ... }
  theme            TEXT NOT NULL,          -- e.g. "Upper Body Blast", "Leg Day Challenge"
  difficulty       TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  estimated_duration INTEGER NOT NULL,    -- minutes
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (gym_id, date)
);

-- Index for fast lookup by gym + date
CREATE INDEX IF NOT EXISTS idx_gym_wod_gym_date ON gym_workouts_of_the_day (gym_id, date DESC);

-- RLS: members can read their own gym's WOD
ALTER TABLE gym_workouts_of_the_day ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read their gym WOD"
  ON gym_workouts_of_the_day
  FOR SELECT
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p WHERE p.id = auth.uid()
    )
  );

-- Members can insert/upsert WOD for their gym (first visitor triggers generation)
CREATE POLICY "Members can insert gym WOD"
  ON gym_workouts_of_the_day
  FOR INSERT
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p WHERE p.id = auth.uid()
    )
  );

-- Admins can update/delete
CREATE POLICY "Admins can manage gym WOD"
  ON gym_workouts_of_the_day
  FOR UPDATE
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can delete gym WOD"
  ON gym_workouts_of_the_day
  FOR DELETE
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );
