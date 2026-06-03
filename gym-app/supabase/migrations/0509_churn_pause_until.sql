-- =============================================================
-- CHURN MODEL v3 — Vacation / hold support
-- Migration: 0509_churn_pause_until.sql
--
-- Adds a per-member "pause churn alerts until" timestamp. When set in the
-- future (or when membership_status = 'frozen'), the churn engine marks the
-- member as state='paused' and excludes them from the at-risk queue — so a
-- loyal member on a 2-week vacation doesn't trigger a false-positive risk
-- spike from the recency decay. Cleared (NULL) = normal scoring.
--
-- See src/lib/churn/MODEL_V3_SPEC.md (edge-case #1: vacation false positive).
-- =============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS churn_pause_until TIMESTAMPTZ;

COMMENT ON COLUMN profiles.churn_pause_until IS
  'When > now(), churn scoring marks this member paused (vacation/hold) and excludes '
  'them from the at-risk queue. Set by admins from the churn page; NULL = normal scoring.';

NOTIFY pgrst, 'reload schema';
