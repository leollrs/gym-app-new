-- =============================================================
-- CHURN RISK SCORES — Persistent Historical Scoring
-- Migration: 0030_churn_risk_scores.sql
-- Stores computed churn scores over time so we can track
-- score velocity (is risk accelerating or decelerating?)
-- =============================================================

CREATE TABLE IF NOT EXISTS churn_risk_scores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id        UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,

  -- Overall composite score (0.0–100.0%)
  score         NUMERIC(4,1) NOT NULL CHECK (score BETWEEN 0 AND 100),
  risk_tier     TEXT NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high', 'critical')),

  -- Individual signal scores (each 0.0–1.0 normalized weight)
  signals       JSONB NOT NULL DEFAULT '{}',
  -- Example: {
  --   "recency": { "value": 14, "score": 0.8, "label": "No visit in 14 days" },
  --   "frequency_drop": { "value": 0.55, "score": 0.9, "label": "55% frequency decline" },
  --   "volume_trend": { "value": -0.30, "score": 0.6, "label": "Volume dropped 30%" },
  --   ...
  -- }

  -- Top contributing signals for quick display
  key_signals   TEXT[] NOT NULL DEFAULT '{}',

  -- Velocity: score change per day over the last 14 days
  -- Positive = risk increasing, negative = risk decreasing
  velocity      NUMERIC(5,2) DEFAULT 0,

  -- Snapshot of raw metrics at time of scoring
  metrics       JSONB NOT NULL DEFAULT '{}',

  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only keep the latest score per member per day (re-runs overwrite)
-- Use timezone-explicit cast to make the expression immutable
CREATE UNIQUE INDEX idx_churn_scores_profile_day
  ON churn_risk_scores(profile_id, ((computed_at AT TIME ZONE 'UTC')::date));

-- Indexes for efficient queries
CREATE INDEX idx_churn_scores_gym_tier
  ON churn_risk_scores(gym_id, risk_tier, score DESC);

CREATE INDEX idx_churn_scores_profile_time
  ON churn_risk_scores(profile_id, computed_at DESC);

CREATE INDEX idx_churn_scores_gym_time
  ON churn_risk_scores(gym_id, computed_at DESC);

-- Enable RLS
ALTER TABLE churn_risk_scores ENABLE ROW LEVEL SECURITY;

-- Admins and trainers can read scores for their gym
CREATE POLICY "churn_scores_read_staff" ON churn_risk_scores
  FOR SELECT USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'trainer')
    )
  );

-- Only the compute-churn edge function (service role) writes scores
-- No authenticated user write policy needed — edge function uses service role
