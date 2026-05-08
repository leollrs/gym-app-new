-- =============================================================
-- ADD: profiles.membership_started_at
-- Migration: 0383_profiles_membership_started_at.sql
--
-- Why:
--   Members who joined the gym BEFORE installing the app were being
--   penalized by the churn engine's 90-day onboarding-risk window
--   (signalTenureRiskV2 in lib/churn/riskScoring.js). A member who
--   has been at the gym for 2 years but installed the app yesterday
--   would show as "Critical 90-day dropout window" because tenure
--   was derived purely from profiles.created_at.
--
--   Admins now need a way to record the member's actual physical
--   gym join date. When set, this column is the source of truth
--   for tenure-based churn signals; when NULL the engine continues
--   to fall back to profiles.created_at.
--
-- Schema:
--   DATE (no time component) — admins enter calendar dates.
--   Nullable — backfill is deliberately deferred so the override
--   only applies to members the admin has explicitly dated.
-- =============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS membership_started_at DATE;

COMMENT ON COLUMN public.profiles.membership_started_at IS
  'Admin-entered date the member physically joined the gym. When set, overrides created_at for tenure-based churn risk calculations. NULL = fall back to created_at.';
