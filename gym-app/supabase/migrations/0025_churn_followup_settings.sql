-- Per-gym configuration for automated churn follow-up notifications
CREATE TABLE churn_followup_settings (
    gym_id            UUID PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
    enabled           BOOLEAN NOT NULL DEFAULT FALSE,
    threshold         INT NOT NULL DEFAULT 61,        -- score >= this triggers follow-up
    cooldown_days     INT NOT NULL DEFAULT 7,          -- min days between follow-ups per member
    message_template  TEXT NOT NULL DEFAULT 'Hey! We noticed you haven''t been in lately. We miss you — come back and crush your goals. Your progress is waiting!',
    last_run_at       TIMESTAMPTZ,
    last_run_count    INT NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE churn_followup_settings ENABLE ROW LEVEL SECURITY;

-- Admins can read/write their own gym's settings
CREATE POLICY "churn_followup_settings_admin"
  ON churn_followup_settings
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
