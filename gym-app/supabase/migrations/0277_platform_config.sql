-- ============================================================
-- Platform Config table — key/value store for feature flags,
-- maintenance mode, and other platform-level settings.
-- Used by the Operations page (super_admin).
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  UUID REFERENCES profiles(id)
);

ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;

-- Only super_admin can read
CREATE POLICY "super_admin_select_platform_config"
  ON platform_config FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- Only super_admin can insert/update/delete
CREATE POLICY "super_admin_all_platform_config"
  ON platform_config FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- ── Seed default feature flags ──────────────────────────────
INSERT INTO platform_config (key, value) VALUES
  ('feature_classes',      '"true"'),
  ('feature_challenges',   '"true"'),
  ('feature_nutrition',    '"true"'),
  ('feature_social',       '"true"'),
  ('feature_leaderboard',  '"true"'),
  ('feature_rewards',      '"true"'),
  ('feature_referrals',    '"true"'),
  ('feature_messaging',    '"true"'),
  ('feature_qr',           '"true"'),
  ('maintenance_mode',     '"false"')
ON CONFLICT (key) DO NOTHING;
