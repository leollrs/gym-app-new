-- =============================================================
-- DRIP CAMPAIGN STEPS — multi-step follow-up sequences
-- Migration: 0034_drip_campaigns.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS drip_campaign_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  step_number   SMALLINT NOT NULL,
  delay_days    SMALLINT NOT NULL DEFAULT 0,
  message_template TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(gym_id, step_number)
);

CREATE INDEX idx_drip_steps_gym ON drip_campaign_steps(gym_id, step_number);

ALTER TABLE drip_campaign_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drip_steps_admin" ON drip_campaign_steps
  FOR ALL
  TO authenticated
  USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

-- Add step tracking to win_back_attempts
ALTER TABLE win_back_attempts ADD COLUMN IF NOT EXISTS step_number SMALLINT DEFAULT 1;
