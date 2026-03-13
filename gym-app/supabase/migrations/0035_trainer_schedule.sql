-- =============================================================
-- TRAINER SESSIONS — scheduling & session booking
-- Migration: 0035_trainer_schedule.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS trainer_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  trainer_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'Training Session',
  notes         TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  duration_mins SMALLINT NOT NULL DEFAULT 60,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','confirmed','completed','cancelled','no_show')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trainer_sessions_trainer ON trainer_sessions(trainer_id, scheduled_at);
CREATE INDEX idx_trainer_sessions_client  ON trainer_sessions(client_id, scheduled_at);
CREATE INDEX idx_trainer_sessions_gym     ON trainer_sessions(gym_id, scheduled_at);

ALTER TABLE trainer_sessions ENABLE ROW LEVEL SECURITY;

-- Trainers can manage their own sessions
CREATE POLICY "trainer_sessions_trainer_all" ON trainer_sessions
  FOR ALL
  TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

-- Clients can view their own sessions
CREATE POLICY "trainer_sessions_client_select" ON trainer_sessions
  FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

-- Admins can view all sessions in their gym
CREATE POLICY "trainer_sessions_admin_select" ON trainer_sessions
  FOR SELECT
  TO authenticated
  USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );
