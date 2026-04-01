-- ============================================================
-- 0173: Digest Configuration
-- Admin-level digest email scheduling preferences.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_digest_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT FALSE,
  frequency TEXT NOT NULL DEFAULT 'weekly', -- 'daily', 'weekly', 'monthly'
  day_of_week INT DEFAULT 1, -- 0=Sun, 1=Mon, ..., 6=Sat (for weekly)
  time_of_day TIME DEFAULT '09:00',
  include_churn BOOLEAN DEFAULT TRUE,
  include_attendance BOOLEAN DEFAULT TRUE,
  include_signups BOOLEAN DEFAULT TRUE,
  include_challenges BOOLEAN DEFAULT TRUE,
  include_revenue BOOLEAN DEFAULT TRUE,
  include_nps BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gym_id, profile_id)
);

ALTER TABLE admin_digest_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage their own digest config"
  ON admin_digest_config FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());
