-- ============================================================
-- 0171: KPI Targets for Admin Analytics
-- Allows admins to set monthly targets for key metrics
-- and track progress against them.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_kpi_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  metric TEXT NOT NULL, -- retention_rate, new_members, active_rate, avg_workouts, checkin_rate, churn_rate
  target_value NUMERIC NOT NULL,
  month DATE NOT NULL, -- first day of the target month
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gym_id, metric, month)
);

CREATE INDEX idx_kpi_targets_gym ON admin_kpi_targets(gym_id, month DESC);

ALTER TABLE admin_kpi_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage KPI targets for their gym"
  ON admin_kpi_targets FOR ALL
  USING (gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid()));
