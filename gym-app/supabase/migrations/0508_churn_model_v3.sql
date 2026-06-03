-- =============================================================
-- CHURN MODEL v3 — Attendance-First Behavioral Retention Model
-- Migration: 0508_churn_model_v3.sql
--
-- Additive + backward-safe. Adds:
--   1. churn_risk_scores: v3 output columns (state / primary_driver /
--      explanation / trend). Nullable, NO default — so existing v2 rows
--      stay NULL and the client (loadScores.js) treats them as "not v3"
--      and recomputes live until the v3 edge function repopulates them.
--   2. gym_churn_weights: per-signal weight columns for the v3 signal set
--      (the old v2 columns are left in place, harmless — the v3 scorer
--      only reads the new ones; missing/NULL → research default 1.0).
--
-- See src/lib/churn/MODEL_V3_SPEC.md for the full model.
-- =============================================================

-- ── 1. churn_risk_scores: v3 output columns ──
ALTER TABLE churn_risk_scores
  ADD COLUMN IF NOT EXISTS state          TEXT,   -- 'scored' | 'dormant' | 'insufficient_data'
  ADD COLUMN IF NOT EXISTS primary_driver TEXT,   -- attendance|engagement|both|dormant|new|onboarding|healthy
  ADD COLUMN IF NOT EXISTS explanation    TEXT,   -- English reason (client localizes from primary_driver)
  ADD COLUMN IF NOT EXISTS trend          TEXT;   -- 'declining' | 'stable' | 'improving' (attendance trajectory)

COMMENT ON COLUMN churn_risk_scores.state IS
  'v3 lifecycle state. insufficient_data = new/imported, never flagged Critical; dormant = 30d+ dark, forced Critical.';
COMMENT ON COLUMN churn_risk_scores.primary_driver IS
  'v3 driver classification — powers the human explanation shown to gym owners.';

-- ── 2. gym_churn_weights: v3 signal weight columns ──
ALTER TABLE gym_churn_weights
  ADD COLUMN IF NOT EXISTS w_recency           NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_frequency         NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_trend             NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_streak            NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_habit_formation   NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_activation        NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_app_decline       NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_challenge_decline NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_logging_decline   NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_rewards_decline   NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_social_decline    NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS w_goals_decline     NUMERIC(4,2) NOT NULL DEFAULT 1.0;

COMMENT ON TABLE gym_churn_weights IS
  'Per-gym churn signal weight multipliers. v3 signal set (12): recency, frequency, '
  'trend, streak, habit_formation, activation, app_decline, challenge_decline, '
  'logging_decline, rewards_decline, social_decline, goals_decline. Blended with '
  'research defaults via Bayesian shrinkage (confidence = min(1, labeled_outcomes/200)).';

-- Reload PostgREST schema cache so the new columns are queryable immediately.
NOTIFY pgrst, 'reload schema';
