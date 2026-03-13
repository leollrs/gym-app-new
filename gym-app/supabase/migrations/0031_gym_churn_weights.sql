-- =============================================================
-- GYM-SPECIFIC CHURN SIGNAL WEIGHTS
-- Migration: 0031_gym_churn_weights.sql
--
-- Each gym starts with the research-based default weights.
-- As churn outcomes accumulate, the calibrate-churn-weights
-- edge function runs logistic regression on labeled data and
-- stores per-gym learned weights here.
--
-- The scoring engine blends defaults with learned weights
-- based on sample size (Bayesian shrinkage):
--   blend = learned * confidence + defaults * (1 - confidence)
--   confidence = min(1, labeled_outcomes / 200)
-- =============================================================

CREATE TABLE IF NOT EXISTS gym_churn_weights (
  gym_id              UUID PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,

  -- Per-signal weight multipliers (1.0 = research default)
  -- Values > 1.0 mean this signal matters MORE for this gym
  -- Values < 1.0 mean it matters LESS
  w_visit_frequency   NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  w_attendance_trend  NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  w_tenure_risk       NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  w_social_engagement NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  w_session_gaps      NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  w_goal_progress     NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  w_engagement_depth  NUMERIC(4,2) NOT NULL DEFAULT 1.0,

  -- Calibration metadata
  labeled_outcomes    INT NOT NULL DEFAULT 0,         -- how many churn labels this is trained on
  confidence          NUMERIC(4,3) NOT NULL DEFAULT 0, -- 0.0–1.0, = min(1, labeled_outcomes/200)
  last_calibrated_at  TIMESTAMPTZ,
  calibration_auc     NUMERIC(4,3),                    -- model quality metric from last calibration

  -- Audit
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE gym_churn_weights ENABLE ROW LEVEL SECURITY;

-- Admins can read their gym's weights
CREATE POLICY "gym_churn_weights_read_admin" ON gym_churn_weights
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

-- Service role writes (edge function calibration)
-- No authenticated user write policy needed

-- ============================================================
-- CHURN OUTCOMES — labeled data for calibration
-- Records when a member actually churned (or didn't).
-- Populated by membership_status changes + inactivity detection.
-- ============================================================

CREATE TABLE IF NOT EXISTS churn_outcomes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,

  -- The churn label
  churned         BOOLEAN NOT NULL,

  -- Reason for the label
  reason          TEXT NOT NULL CHECK (reason IN (
    'cancelled',           -- membership_status changed to cancelled
    'frozen',              -- membership_status changed to frozen
    'inactive_30d',        -- 30+ days with no activity
    'inactive_60d',        -- 60+ days with no activity
    'retained_6m',         -- active for 6+ months without a 14-day gap (churned=false)
    'win_back_returned',   -- came back after a win-back campaign (churned=false)
    'manual'               -- admin manually labeled
  )),

  -- Snapshot of signal scores AT THE TIME the outcome was recorded
  -- This is what the calibration model trains on
  signal_snapshot JSONB NOT NULL DEFAULT '{}',
  -- Example: { "visit_frequency": 24, "attendance_trend": 13, ... }

  -- The composite score at time of labeling (0.0–100.0%)
  score_at_label  NUMERIC(4,1),

  labeled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One label per member per reason per day (prevent duplicates from re-runs)
CREATE UNIQUE INDEX idx_churn_outcomes_dedup
  ON churn_outcomes(profile_id, reason, ((labeled_at AT TIME ZONE 'UTC')::date));

CREATE INDEX idx_churn_outcomes_gym
  ON churn_outcomes(gym_id, churned, labeled_at DESC);

CREATE INDEX idx_churn_outcomes_profile
  ON churn_outcomes(profile_id, labeled_at DESC);

-- Enable RLS
ALTER TABLE churn_outcomes ENABLE ROW LEVEL SECURITY;

-- Admins can read outcomes for their gym
CREATE POLICY "churn_outcomes_read_admin" ON churn_outcomes
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );
