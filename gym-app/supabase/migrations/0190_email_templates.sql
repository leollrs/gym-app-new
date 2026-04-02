-- ── Email Templates ────────────────────────────────────────────────
-- Stores per-gym email templates (custom + prebuilt snapshots).
-- template_data JSONB holds: header, hero, body, cta, footer, colors.

CREATE TABLE gym_email_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID        NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  template_type TEXT        NOT NULL DEFAULT 'custom',
  template_data JSONB       NOT NULL DEFAULT '{}',
  is_prebuilt   BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_email_templates_gym_id ON gym_email_templates(gym_id);
CREATE INDEX idx_email_templates_type   ON gym_email_templates(template_type);

-- RLS
ALTER TABLE gym_email_templates ENABLE ROW LEVEL SECURITY;

-- Admins & trainers can read own gym's templates
CREATE POLICY email_templates_select ON gym_email_templates
  FOR SELECT USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'trainer')
    )
  );

-- Admins can insert templates for own gym
CREATE POLICY email_templates_insert ON gym_email_templates
  FOR INSERT WITH CHECK (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can update own gym's templates
CREATE POLICY email_templates_update ON gym_email_templates
  FOR UPDATE USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can delete own gym's templates
CREATE POLICY email_templates_delete ON gym_email_templates
  FOR DELETE USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_email_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_email_template_updated_at
  BEFORE UPDATE ON gym_email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_email_template_updated_at();
