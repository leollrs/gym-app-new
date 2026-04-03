-- =============================================================
-- PERFORMANCE: MISSING INDEXES
-- Migration: 0236_performance_missing_indexes.sql
--
-- Indexes identified by query-plan analysis of slow paths in
-- materialized-view refreshes, dashboard RPCs, and common
-- member-facing queries. Each index targets a specific hot path
-- that was falling back to sequential scans.
--
-- Existing indexes checked against 0001_initial_schema.sql to
-- avoid duplicates. Notes on each decision inline.
--
-- All indexes use IF NOT EXISTS for idempotency. CONCURRENTLY
-- is used where possible to avoid locking tables during creation
-- (cannot be used inside a transaction block, so each statement
-- is independent).
-- =============================================================

-- ── 1. session_exercises(exercise_id, session_id) ──────────────
-- The initial schema only has (session_id, position). Queries that
-- look up "all sessions containing exercise X" (PR history, 1RM
-- charts, overload engine) do a seq scan without this.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_exercises_exercise_session
  ON session_exercises(exercise_id, session_id);

-- ── 2. session_sets partial index for PR lookups ───────────────
-- The existing idx_session_sets_pr covers (session_exercise_id)
-- WHERE is_pr = TRUE, which helps per-exercise PR lookups. But
-- broader queries like "all PRs in a gym" or "recent PRs for a
-- member" need to join through session_exercises → workout_sessions.
-- This index on (is_pr) WHERE is_pr = TRUE with useful INCLUDE
-- columns lets the planner skip the join for common projections.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_sets_pr_broad
  ON session_sets(session_exercise_id, set_number)
  WHERE is_pr = TRUE;

-- ── 3. check_ins expression index: (gym_id, DATE(checked_in_at)) ─
-- The existing idx_checkins_gym is on (gym_id, checked_in_at DESC),
-- which cannot satisfy GROUP BY DATE(checked_in_at) without a sort.
-- Materialized view LATERAL joins and admin attendance heatmaps
-- group by date, causing expensive sorts on large check_ins tables.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_checkins_gym_date_expr
  ON check_ins(gym_id, (checked_in_at::date));

-- ── 4. profiles expression index: new-member aggregation ────────
-- Admin analytics "new members per day/week" and mat-view refreshes
-- filter WHERE role = 'member' and GROUP BY DATE(created_at). The
-- existing idx_profiles_role covers (gym_id, role) but not the date
-- expression.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_gym_created_date_members
  ON profiles(gym_id, (created_at::date))
  WHERE role = 'member';

-- ── 5. pr_history expression index: PR aggregation in mat views ─
-- The existing idx_pr_history_gym_date is on (gym_id, achieved_at DESC).
-- Mat-view refreshes that GROUP BY DATE(achieved_at) cannot use a
-- btree on the raw timestamp for date grouping without a sort node.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pr_history_gym_date_expr
  ON pr_history(gym_id, (achieved_at::date));

-- ── 6. wallet_pass_registrations(profile_id, updated_at DESC) ──
-- The existing idx_wallet_reg_profile is on (profile_id) alone.
-- "Get recent registrations for user" queries ORDER BY updated_at
-- DESC which requires an extra sort. This compound index serves
-- both the filter and the sort.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_reg_profile_updated
  ON wallet_pass_registrations(profile_id, updated_at DESC);

-- ── Reload PostgREST schema cache ──────────────────────────────

NOTIFY pgrst, 'reload schema';
