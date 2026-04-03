-- Workout schedule pattern tracking
-- Stores detected workout schedule patterns per user for smart visit notifications.

CREATE TABLE IF NOT EXISTS workout_schedule_patterns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id        uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  preferred_days      int[]   NOT NULL DEFAULT '{}',          -- 0=Sun, 1=Mon, ..., 6=Sat
  preferred_day_names text[]  NOT NULL DEFAULT '{}',          -- e.g. {'Monday','Wednesday','Friday'}
  avg_start_hour      int     NOT NULL DEFAULT 0,             -- 0-23
  avg_start_minute    int     NOT NULL DEFAULT 0,             -- 0-59
  total_sessions_analyzed int NOT NULL DEFAULT 0,
  confidence          numeric(4,3) NOT NULL DEFAULT 0,        -- 0.000 – 1.000
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id)
);

-- Index for quick lookups by profile
CREATE INDEX IF NOT EXISTS idx_wsp_profile_id ON workout_schedule_patterns(profile_id);

-- RLS
ALTER TABLE workout_schedule_patterns ENABLE ROW LEVEL SECURITY;

-- Members can read and upsert their own patterns
CREATE POLICY wsp_select_own ON workout_schedule_patterns
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY wsp_insert_own ON workout_schedule_patterns
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY wsp_update_own ON workout_schedule_patterns
  FOR UPDATE USING (auth.uid() = profile_id);

-- Admins and trainers can read patterns for their gym members
CREATE POLICY wsp_select_gym_staff ON workout_schedule_patterns
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.gym_id = workout_schedule_patterns.gym_id
        AND p.role IN ('admin', 'trainer')
    )
  );
