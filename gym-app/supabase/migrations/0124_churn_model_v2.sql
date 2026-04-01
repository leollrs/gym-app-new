-- =============================================================
-- CHURN MODEL v2 — Add 5 new signal weight columns
-- Migration: 0124_churn_model_v2.sql
--
-- Adds per-gym weight multipliers for the 5 new churn signals:
--   - anchor_day:            habitual workout day adherence
--   - app_engagement:        notification open rate + app activity
--   - comms_responsiveness:  response to outreach attempts
--   - referral_activity:     referral behavior (invested members)
--   - workout_type_shift:    declining exercise variety
--
-- All default to 1.0 (research baseline), matching existing
-- columns so the calibration engine can learn gym-specific
-- weights via logistic regression.
-- =============================================================

ALTER TABLE gym_churn_weights
  ADD COLUMN IF NOT EXISTS w_anchor_day            NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_app_engagement        NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_comms_responsiveness  NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_referral_activity     NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_workout_type_shift    NUMERIC(4,2) NOT NULL DEFAULT 1.0;

-- Add a comment documenting the v2 signal budget (100 pts across 12 signals)
COMMENT ON TABLE gym_churn_weights IS
  'Per-gym churn signal weight multipliers (v2). '
  '12 signals, 100-point budget: '
  'visit_frequency(22), attendance_trend(14), tenure_risk(12), social_engagement(10), '
  'anchor_day(8), session_gaps(7), goal_progress(7), engagement_depth(5), '
  'app_engagement(5), comms_responsiveness(4), referral_activity(3), workout_type_shift(3).';
