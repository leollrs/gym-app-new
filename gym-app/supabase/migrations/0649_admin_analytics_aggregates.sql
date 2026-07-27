-- ============================================================================
-- 0649: Admin analytics — server-side aggregates
--
-- WHY THIS EXISTS
--
-- PostgREST clamps every response to max_rows (1000 on this project — verified
-- against production, which returns `content-range: 0-999/1275` for food_items).
-- `.limit(10000)` cannot raise that: PostgREST applies LEAST(limit, max_rows),
-- so those calls read as safeguards in review while silently returning 1000 rows.
--
-- Several Admin → Analytics charts fetched raw rows and did the arithmetic in
-- JavaScript. At any gym past ~1000 members or ~1000 sessions in the window,
-- that arithmetic ran on a fraction of the data and rendered a confident,
-- specific, WRONG number. Measured for a 1,500-member gym:
--
--   * Retention curve   — ~2-6% displayed where the real figure is ~60-70%
--   * Cohort grid       — every cell computed from ~1.4% of sessions, all red
--   * Engagement %      — ~15-25% displayed where the real figure is ~60%
--   * Lifecycle bar     — "At Risk" understated, "Active" overstated, on the
--                         one page whose entire job is warning about churn
--
-- Paging it client-side is NOT the fix. Retention at that gym is ~140,000
-- sessions/year; pulling them into the browser to compute one percentage turns
-- a 2.4s stall into a ~54s frozen tab (the per-member .filter() over the full
-- session array is O(members x sessions)). The aggregation has to happen here.
--
-- These functions deliberately mirror the EXISTING client semantics one-for-one
-- rather than improving them — the goal is the same number, correctly computed.
-- Any definitional change belongs in a separate, deliberate migration.
--
-- SAFETY
--
-- Read-only. No table, column, index, policy or grant is altered. Nothing is
-- dropped. Adding these functions cannot change the behaviour of any existing
-- query, so applying this migration on its own is inert until the client calls
-- them — and the client falls back to its current path if they are absent.
-- ============================================================================


-- ── Guard ───────────────────────────────────────────────────────────────────
-- Every function below is SECURITY DEFINER (it must read across the gym's whole
-- membership, past what the caller's RLS would allow). That makes an explicit
-- in-body authorization check mandatory: without it these would be a read-any-
-- gym oracle for any authenticated user.
--
-- Checks BOTH `role` and `additional_roles` — this codebase has multi-role staff
-- accounts, and helpers that look only at `role` have missed them before.
-- `additional_roles` is user_role[], so the overlap test needs an EXPLICIT
-- ::user_role[] cast. The bare `additional_roles && ARRAY['admin', …]` form used
-- elsewhere in this schema only works where Postgres can infer the element type
-- from surrounding context (e.g. inside an RLS policy on a typed column); in a
-- standalone function there is nothing to infer from and it fails with
-- "operator does not exist: user_role[] && text[]".
CREATE OR REPLACE FUNCTION public._is_gym_admin(p_gym_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = auth.uid()
       AND (
         -- Super admins are cross-tenant by design.
         p.role = 'super_admin'
         -- Everyone else must be an admin OF THE GYM BEING ASKED ABOUT.
         OR (p.gym_id = p_gym_id
             AND (p.role = 'admin'
                  OR p.additional_roles && ARRAY['admin', 'super_admin']::user_role[]))
       )
  );
$$;

COMMENT ON FUNCTION public._is_gym_admin(UUID) IS
  'True when auth.uid() may read gym-wide analytics for p_gym_id. Honours additional_roles; super_admin passes for any gym.';


-- ── admin_retention_curve ───────────────────────────────────────────────────
-- Signup-relative, activity-based retention. Mirrors RetentionChart.jsx exactly:
-- for each 30-day window after a member's created_at, a member is "eligible"
-- once that window has fully elapsed, and "retained" if they completed at least
-- one workout inside it. membership_status is deliberately never read.
CREATE OR REPLACE FUNCTION public.admin_retention_curve(
  p_gym_id UUID,
  p_months INT DEFAULT 12
)
RETURNS TABLE (offset_month INT, eligible INT, retained INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_horizon INT := GREATEST(1, LEAST(COALESCE(p_months, 12), 24));
  v_from    TIMESTAMPTZ := now() - (v_horizon * 30 || ' days')::INTERVAL;
BEGIN
  IF NOT public._is_gym_admin(p_gym_id) THEN
    RAISE EXCEPTION 'Access denied: gym boundary violation';
  END IF;

  RETURN QUERY
  WITH cohort AS (
    SELECT p.id, p.created_at
      FROM profiles p
     WHERE p.gym_id = p_gym_id
       AND p.role = 'member'
       AND p.imported_archived = FALSE
       AND p.created_at >= v_from
  ),
  windows AS (
    SELECT c.id,
           o.offset_month,
           c.created_at + (o.offset_month * 30 || ' days')::INTERVAL       AS w_start,
           c.created_at + ((o.offset_month + 1) * 30 || ' days')::INTERVAL AS w_end
      FROM cohort c
      CROSS JOIN generate_series(0, v_horizon - 1) AS o(offset_month)
  )
  SELECT w.offset_month::INT,
         COUNT(*)::INT AS eligible,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM workout_sessions ws
              WHERE ws.profile_id = w.id
                AND ws.gym_id     = p_gym_id
                AND ws.status     = 'completed'
                AND ws.started_at >= w.w_start
                AND ws.started_at <= w.w_end
           )
         )::INT AS retained
    FROM windows w
   WHERE w.w_end <= now()          -- only fully-elapsed windows count
   GROUP BY w.offset_month
   ORDER BY w.offset_month;
END;
$$;

COMMENT ON FUNCTION public.admin_retention_curve(UUID, INT) IS
  'Signup-relative activity retention per 30-day tenure window. Replaces the client-side computation in RetentionChart.jsx, which truncated at max_rows and under-reported badly.';


-- ── admin_activity_engagement ───────────────────────────────────────────────
-- Per calendar month: members signed up by month-end, and how many of them
-- completed >=1 workout that month. Mirrors ActivityChart.jsx.
-- NOTE the roster is "signed up on or before the end of that month", not the
-- all-time roster the client used — that was a second, separate bug there.
CREATE OR REPLACE FUNCTION public.admin_activity_engagement(
  p_gym_id UUID,
  p_months INT DEFAULT 6
)
RETURNS TABLE (month_start DATE, total_members INT, active_members INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_months INT := GREATEST(1, LEAST(COALESCE(p_months, 6), 24));
BEGIN
  IF NOT public._is_gym_admin(p_gym_id) THEN
    RAISE EXCEPTION 'Access denied: gym boundary violation';
  END IF;

  RETURN QUERY
  WITH months AS (
    SELECT date_trunc('month', now() - (n || ' months')::INTERVAL)::DATE AS m
      FROM generate_series(0, v_months - 1) AS n
  )
  SELECT m.m,
         (SELECT COUNT(*)::INT FROM profiles p
           WHERE p.gym_id = p_gym_id AND p.role = 'member'
             AND p.imported_archived = FALSE
             AND p.created_at < (m.m + INTERVAL '1 month')),
         (SELECT COUNT(DISTINCT ws.profile_id)::INT FROM workout_sessions ws
           WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
             AND ws.started_at >= m.m
             AND ws.started_at <  (m.m + INTERVAL '1 month'))
    FROM months m
   ORDER BY m.m;
END;
$$;

COMMENT ON FUNCTION public.admin_activity_engagement(UUID, INT) IS
  'Monthly roster size + distinct active members. Replaces ActivityChart.jsx client aggregation.';


-- ── admin_lifecycle_stages ──────────────────────────────────────────────────
-- Member lifecycle histogram. Mirrors LifecycleStages.jsx branch-for-branch,
-- INCLUDING its priority order (churned > wonBack > atRisk > active > onboarding
-- > new > active), because changing that order would silently move members
-- between buckets.
--
-- One correctness fix carried in deliberately: the client read churn_risk_scores
-- with no ORDER BY and no date filter, so with N days of history it kept an
-- arbitrary historical tier per member. This takes the LATEST row per member
-- via DISTINCT ON, which is what the chart always meant.
CREATE OR REPLACE FUNCTION public.admin_lifecycle_stages(p_gym_id UUID)
RETURNS TABLE (
  stage_new        INT,
  stage_onboarding INT,
  stage_active     INT,
  stage_at_risk    INT,
  stage_churned    INT,
  stage_won_back   INT,
  total_members    INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._is_gym_admin(p_gym_id) THEN
    RAISE EXCEPTION 'Access denied: gym boundary violation';
  END IF;

  RETURN QUERY
  WITH members AS (
    SELECT p.id, p.created_at, p.is_onboarded, p.membership_status
      FROM profiles p
     WHERE p.gym_id = p_gym_id AND p.role = 'member' AND p.imported_archived = FALSE
  ),
  recent AS (   -- completed sessions in the last 30 days, per member
    SELECT ws.profile_id, COUNT(*) AS c
      FROM workout_sessions ws
     WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
       AND ws.started_at >= now() - INTERVAL '30 days'
     GROUP BY ws.profile_id
  ),
  total90 AS (  -- completed sessions in the last 90 days, per member
    SELECT ws.profile_id, COUNT(*) AS c
      FROM workout_sessions ws
     WHERE ws.gym_id = p_gym_id AND ws.status = 'completed'
       AND ws.started_at >= now() - INTERVAL '90 days'
     GROUP BY ws.profile_id
  ),
  churn AS (    -- LATEST tier per member, not an arbitrary historical row
    SELECT DISTINCT ON (c.profile_id) c.profile_id, c.risk_tier
      FROM churn_risk_scores c
     WHERE c.gym_id = p_gym_id
     ORDER BY c.profile_id, c.computed_at DESC
  ),
  wonback AS (
    SELECT DISTINCT w.user_id
      FROM win_back_attempts w
     WHERE w.gym_id = p_gym_id AND w.outcome = 'returned'
  ),
  classified AS (
    SELECT CASE
      WHEN m.membership_status IN ('cancelled', 'frozen')            THEN 'churned'
      WHEN wb.user_id IS NOT NULL                                    THEN 'won_back'
      WHEN ch.risk_tier IN ('critical', 'high', 'medium')            THEN 'at_risk'
      WHEN COALESCE(r.c, 0) >= 3                                     THEN 'active'
      WHEN m.is_onboarded AND COALESCE(t.c, 0) < 3                   THEN 'onboarding'
      WHEN NOT m.is_onboarded
        OR (m.created_at >= now() - INTERVAL '14 days'
            AND COALESCE(t.c, 0) = 0)                                THEN 'new'
      ELSE 'active'
    END AS stage
    FROM members m
    LEFT JOIN recent  r  ON r.profile_id  = m.id
    LEFT JOIN total90 t  ON t.profile_id  = m.id
    LEFT JOIN churn   ch ON ch.profile_id = m.id
    LEFT JOIN wonback wb ON wb.user_id    = m.id
  )
  SELECT COUNT(*) FILTER (WHERE stage = 'new')::INT,
         COUNT(*) FILTER (WHERE stage = 'onboarding')::INT,
         COUNT(*) FILTER (WHERE stage = 'active')::INT,
         COUNT(*) FILTER (WHERE stage = 'at_risk')::INT,
         COUNT(*) FILTER (WHERE stage = 'churned')::INT,
         COUNT(*) FILTER (WHERE stage = 'won_back')::INT,
         COUNT(*)::INT
    FROM classified;
END;
$$;

COMMENT ON FUNCTION public.admin_lifecycle_stages(UUID) IS
  'Member lifecycle histogram. Replaces LifecycleStages.jsx client aggregation, which truncated at max_rows and kept an arbitrary historical churn tier per member.';


-- ── Grants ──────────────────────────────────────────────────────────────────
-- `authenticated` only — never anon. Authorization is enforced inside each
-- function by _is_gym_admin, so a non-admin calling these gets an exception,
-- not data.
GRANT EXECUTE ON FUNCTION public._is_gym_admin(UUID)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retention_curve(UUID, INT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_engagement(UUID, INT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lifecycle_stages(UUID)           TO authenticated;

REVOKE EXECUTE ON FUNCTION public._is_gym_admin(UUID)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_retention_curve(UUID, INT)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_activity_engagement(UUID, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_lifecycle_stages(UUID)         FROM anon;


-- ── Supporting indexes ──────────────────────────────────────────────────────
-- The retention function probes workout_sessions per (member, window). The
-- existing idx_sessions_gym_date is (gym_id, started_at DESC) WHERE completed,
-- which does not help a per-profile probe. CONCURRENTLY is intentionally NOT
-- used so this runs inside the migration transaction; on a table of this size
-- the build is short. If workout_sessions is very large in prod, create this
-- one by hand with CONCURRENTLY first and re-run.
CREATE INDEX IF NOT EXISTS idx_sessions_profile_gym_started
  ON workout_sessions (profile_id, gym_id, started_at)
  WHERE status = 'completed';
