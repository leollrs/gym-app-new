-- =============================================================
-- WIN-BACK ATTEMPTS — tracks admin outreach to churned members
-- Migration: 0032_win_back_attempts.sql
--
-- Records every win-back message sent from AdminChurn,
-- including any incentive offer and the eventual outcome.
-- Used to measure campaign effectiveness and prevent
-- spamming the same member with repeated outreach.
-- =============================================================

CREATE TABLE IF NOT EXISTS win_back_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  admin_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,

  -- What was sent
  message     TEXT NOT NULL,
  offer       TEXT,                -- e.g. 'Free PT session', '1 month discount', null

  -- Outcome tracking
  outcome     TEXT NOT NULL DEFAULT 'no_response' CHECK (outcome IN (
    'no_response',    -- no activity yet after outreach
    'returned',       -- member came back (check-in or session after this attempt)
    'declined',       -- member explicitly declined or cancelled
    'pending'         -- just sent, waiting
  )),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_win_back_gym
  ON win_back_attempts(gym_id, created_at DESC);

CREATE INDEX idx_win_back_user
  ON win_back_attempts(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE win_back_attempts ENABLE ROW LEVEL SECURITY;

-- Admins can read/write their gym's win-back attempts
CREATE POLICY "win_back_attempts_admin" ON win_back_attempts
  FOR ALL
  TO authenticated
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );
