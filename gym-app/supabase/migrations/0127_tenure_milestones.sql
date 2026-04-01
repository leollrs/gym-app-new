-- Tenure milestone automation settings per gym
-- When enabled, the compute-churn-scores edge function should check each member's
-- tenure (days since profiles.created_at) and, if a milestone is reached and no
-- tenure_milestone_log entry exists for that member + milestone day count, insert
-- a proactive "check-in" notification using the configured message template.
-- This allows gyms to automatically celebrate member anniversaries (90 days,
-- 180 days, 1 year, etc.) and reduce churn through positive reinforcement.

CREATE TABLE IF NOT EXISTS tenure_milestone_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id     UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE UNIQUE,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  milestones JSONB NOT NULL DEFAULT '[{"days":90,"message":""},{"days":180,"message":""},{"days":365,"message":""}]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log to prevent duplicate milestone notifications
CREATE TABLE IF NOT EXISTS tenure_milestone_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  milestone_days INTEGER NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(gym_id, profile_id, milestone_days)
);

-- RLS: admin access only
ALTER TABLE tenure_milestone_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenure_milestone_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage tenure milestone settings"
  ON tenure_milestone_settings
  FOR ALL
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

CREATE POLICY "Admins can manage tenure milestone log"
  ON tenure_milestone_log
  FOR ALL
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

-- Index for fast lookup during milestone checks
CREATE INDEX IF NOT EXISTS idx_tenure_milestone_log_lookup
  ON tenure_milestone_log(gym_id, profile_id, milestone_days);
