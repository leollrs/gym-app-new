-- =============================================================
-- Feature Adoption Tracking — records admin/trainer interactions
-- with platform features per gym. Powers super-admin analytics
-- to understand which features are actually being used.
-- =============================================================

-- ── Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_adoption_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL,
  action      TEXT NOT NULL DEFAULT 'page_view',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT feature_adoption_feature_check CHECK (
    feature IN (
      'classes', 'challenges', 'churn_winback', 'messaging',
      'analytics', 'programs', 'referrals', 'rewards', 'nps',
      'segments', 'ab_testing', 'store', 'reports', 'email_templates'
    )
  ),
  CONSTRAINT feature_adoption_action_check CHECK (
    action IN ('page_view', 'create', 'update', 'delete', 'export')
  )
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_feature_adoption_gym_feature_date
  ON feature_adoption_events (gym_id, feature, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feature_adoption_gym_date
  ON feature_adoption_events (gym_id, created_at DESC);

COMMENT ON TABLE feature_adoption_events IS
  'Tracks admin/trainer usage of platform features per gym. Used for super-admin adoption analytics.';

-- ── RLS ────────────────────────────────────────────────────
ALTER TABLE feature_adoption_events ENABLE ROW LEVEL SECURITY;

-- Super-admin can read all events
CREATE POLICY "super_admin_select_feature_adoption"
  ON feature_adoption_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Admins/trainers can insert events for their own gym
CREATE POLICY "admin_insert_feature_adoption"
  ON feature_adoption_events FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'trainer', 'super_admin')
    )
  );

-- ── Aggregated view per gym + feature ──────────────────────
CREATE OR REPLACE VIEW v_gym_feature_adoption AS
SELECT
  fa.gym_id,
  fa.feature,
  COUNT(*)                        AS total_events,
  COUNT(DISTINCT fa.profile_id)   AS unique_users,
  MAX(fa.created_at)              AS last_used,
  COUNT(*) FILTER (
    WHERE fa.created_at >= now() - INTERVAL '30 days'
  )                               AS events_last_30d
FROM feature_adoption_events fa
GROUP BY fa.gym_id, fa.feature;

COMMENT ON VIEW v_gym_feature_adoption IS
  'Aggregated feature adoption metrics per gym: total events, unique users, recency, and 30-day activity.';
