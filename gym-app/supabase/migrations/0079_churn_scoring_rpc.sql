-- =============================================================
-- CHURN SCORING RPC — Server-side batch computation
-- Migration: 0079_churn_scoring_rpc.sql
--
-- Moves churn risk scoring from client-side to a database
-- function that can be called on-demand or on a schedule.
-- =============================================================

-- Ensure we have a unique constraint on (profile_id, gym_id) for upsert.
-- The 0030 migration has a unique index on (profile_id, date) but we need
-- one-row-per-member-per-gym semantics for the latest score.
CREATE UNIQUE INDEX IF NOT EXISTS idx_churn_scores_profile_gym
  ON churn_risk_scores(profile_id, gym_id);

CREATE OR REPLACE FUNCTION public.compute_churn_scores(p_gym_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Authorization check ────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only admins of this gym can compute churn scores';
  END IF;

  -- ── Batch compute and upsert ───────────────────────────────
  WITH member_sessions AS (
    SELECT
      ws.profile_id,
      COUNT(*) FILTER (WHERE ws.completed_at > NOW() - INTERVAL '7 days')  AS sessions_7d,
      COUNT(*) FILTER (WHERE ws.completed_at > NOW() - INTERVAL '14 days') AS sessions_14d,
      COUNT(*) FILTER (WHERE ws.completed_at > NOW() - INTERVAL '30 days') AS sessions_30d,
      MAX(ws.completed_at) AS last_workout_at
    FROM workout_sessions ws
    WHERE ws.gym_id = p_gym_id
      AND ws.status = 'completed'
    GROUP BY ws.profile_id
  ),
  scored AS (
    SELECT
      p.id AS profile_id,
      -- ── Base score from activity windows ──────────────────
      CASE
        -- No workouts in 30+ days (or never)
        WHEN COALESCE(ms.sessions_30d, 0) = 0 THEN
          CASE
            WHEN p.last_active_at < NOW() - INTERVAL '30 days' OR p.last_active_at IS NULL
              THEN 95
            ELSE 85
          END
        -- No workouts in 14-30 days
        WHEN ms.sessions_14d = 0 THEN 70
        -- No workouts in 7-14 days
        WHEN ms.sessions_7d = 0 THEN 45
        -- Declining frequency (fewer sessions this week vs prior week)
        WHEN ms.sessions_7d < (ms.sessions_14d - ms.sessions_7d) THEN 30
        -- Active recently
        ELSE GREATEST(0, 20 - ms.sessions_7d * 5)
      END
      -- ── Modifiers ─────────────────────────────────────────
      + CASE
          WHEN COALESCE(ms.sessions_7d, 0) > 0
            AND ms.sessions_7d < (ms.sessions_14d - ms.sessions_7d)
          THEN 10  -- declining frequency bonus
          ELSE 0
        END
      + CASE
          WHEN sc.streak_broken_at IS NOT NULL
            AND sc.streak_broken_at > NOW() - INTERVAL '7 days'
          THEN 10  -- streak broke recently
          ELSE 0
        END
      AS raw_score,

      -- ── Raw data for signal building ──────────────────────
      COALESCE(ms.sessions_7d, 0)  AS sessions_7d,
      COALESCE(ms.sessions_14d, 0) AS sessions_14d,
      COALESCE(ms.sessions_30d, 0) AS sessions_30d,
      p.last_active_at,
      p.is_onboarded,
      COALESCE(sc.current_streak_days, 0) AS streak,
      (sc.streak_broken_at IS NOT NULL
        AND sc.streak_broken_at > NOW() - INTERVAL '7 days') AS streak_recently_broken

    FROM profiles p
    LEFT JOIN member_sessions ms ON ms.profile_id = p.id
    LEFT JOIN streak_cache sc    ON sc.profile_id = p.id
    WHERE p.gym_id = p_gym_id
      AND p.role = 'member'
  ),
  final_scores AS (
    SELECT
      s.profile_id,
      -- Clamp score to 0-100
      LEAST(100, GREATEST(0, s.raw_score))::NUMERIC(4,1) AS score,
      -- Determine risk tier
      CASE
        WHEN LEAST(100, GREATEST(0, s.raw_score)) >= 80 THEN 'critical'
        WHEN LEAST(100, GREATEST(0, s.raw_score)) >= 60 THEN 'high'
        WHEN LEAST(100, GREATEST(0, s.raw_score)) >= 30 THEN 'medium'
        ELSE 'low'
      END AS risk_tier,
      -- Build key_signals array
      ARRAY_REMOVE(ARRAY[
        CASE WHEN s.sessions_30d = 0 AND (s.last_active_at < NOW() - INTERVAL '30 days' OR s.last_active_at IS NULL)
          THEN 'No workouts in 30+ days' END,
        CASE WHEN s.sessions_30d > 0 AND s.sessions_14d = 0
          THEN 'No workouts in 14+ days' END,
        CASE WHEN s.sessions_7d > 0 AND s.sessions_7d < (s.sessions_14d - s.sessions_7d)
          THEN 'Declining workout frequency' END,
        CASE WHEN s.streak_recently_broken
          THEN 'Streak broken recently' END,
        CASE WHEN NOT s.is_onboarded
          THEN 'Never completed onboarding' END
      ], NULL) AS key_signals
    FROM scored s
  )
  INSERT INTO churn_risk_scores (profile_id, gym_id, score, risk_tier, key_signals, computed_at)
  SELECT
    fs.profile_id,
    p_gym_id,
    fs.score,
    fs.risk_tier,
    fs.key_signals,
    NOW()
  FROM final_scores fs
  ON CONFLICT (profile_id, gym_id) DO UPDATE SET
    score       = EXCLUDED.score,
    risk_tier   = EXCLUDED.risk_tier,
    key_signals = EXCLUDED.key_signals,
    computed_at = EXCLUDED.computed_at;

END;
$$;

-- Grant execute to authenticated users (authorization is checked inside the function)
GRANT EXECUTE ON FUNCTION public.compute_churn_scores(UUID) TO authenticated;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
