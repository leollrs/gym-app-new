-- ============================================================================
-- 0425: Fix tv_get_dashboard_data — record ->> operator error
--
-- Bug: the challenge-participants subquery aliased its results as `p` and
-- tried to sort by `(p->>'score')::NUMERIC`. The `->>` operator only works
-- on JSON/JSONB, not on RECORDs. The function ran fine for the leaderboard
-- sections (those were plain queries) but threw "operator does not exist:
-- record ->> unknown" the moment it hit the challenges aggregation. The
-- whole RPC returned 404 with that error string in the body, leaving the
-- TV display showing "0 SLIDES" even after the gym had active challenges.
--
-- Fix: reference `p.score` directly for ordering (record column access
-- works) and aggregate `to_jsonb(p)` so the resulting JSON array stays in
-- the right order.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tv_get_dashboard_data(
  p_code       TEXT,
  p_session_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings   RECORD;
  v_gym_id     UUID;
  v_thirty_ago TIMESTAMPTZ := now() - interval '30 days';
  v_volume     JSONB;
  v_workouts   JSONB;
  v_prs        JSONB;
  v_improved   JSONB;
  v_consistency JSONB;
  v_checkins   JSONB;
  v_challenges JSONB;
BEGIN
  SELECT * INTO v_settings FROM gym_tv_settings WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;
  v_gym_id := v_settings.gym_id;

  -- Heartbeat — see 0423 for full rationale on the update-first-then-insert
  -- pattern (defends against the rare race where the session row was wiped
  -- between auth and the first dashboard fetch).
  UPDATE gym_tv_sessions
  SET last_heartbeat_at = now()
  WHERE gym_id = v_gym_id AND session_id = p_session_id;
  IF NOT FOUND THEN
    INSERT INTO gym_tv_sessions (gym_id, session_id)
    VALUES (v_gym_id, p_session_id)
    ON CONFLICT (gym_id, session_id) DO UPDATE SET last_heartbeat_at = now();
  END IF;

  -- ── Leaderboards (unchanged from 0423) ─────────────────────────────────
  -- volume: top 10 by total completed workout volume in the last 30 days
  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_volume FROM (
    SELECT
      ws.profile_id AS id,
      p.full_name   AS name,
      ROUND(SUM(ws.total_volume_lbs)::NUMERIC) AS score
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id
      AND ws.status = 'completed'
      AND ws.started_at >= v_thirty_ago
      AND p.leaderboard_visible = TRUE
      AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    HAVING SUM(ws.total_volume_lbs) > 0
    ORDER BY score DESC
    LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_workouts FROM (
    SELECT
      ws.profile_id AS id,
      p.full_name   AS name,
      COUNT(*)::INT AS score
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id
      AND ws.status = 'completed'
      AND ws.started_at >= v_thirty_ago
      AND p.leaderboard_visible = TRUE
      AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    ORDER BY score DESC
    LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_prs FROM (
    SELECT
      pr.profile_id AS id,
      p.full_name   AS name,
      ROUND(MAX(pr.estimated_1rm)::NUMERIC) AS score
    FROM personal_records pr
    JOIN profiles p ON p.id = pr.profile_id
    WHERE p.gym_id = v_gym_id
      AND p.leaderboard_visible = TRUE
      AND p.imported_archived = FALSE
    GROUP BY pr.profile_id, p.full_name
    ORDER BY score DESC
    LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_improved FROM (
    WITH this_month AS (
      SELECT ws.profile_id, SUM(ws.total_volume_lbs) AS vol
      FROM workout_sessions ws
      WHERE ws.gym_id = v_gym_id
        AND ws.status = 'completed'
        AND ws.started_at >= date_trunc('month', now())
      GROUP BY ws.profile_id
    ),
    last_month AS (
      SELECT ws.profile_id, SUM(ws.total_volume_lbs) AS vol
      FROM workout_sessions ws
      WHERE ws.gym_id = v_gym_id
        AND ws.status = 'completed'
        AND ws.started_at >= date_trunc('month', now() - interval '1 month')
        AND ws.started_at <  date_trunc('month', now())
      GROUP BY ws.profile_id
    )
    SELECT
      tm.profile_id AS id,
      p.full_name   AS name,
      ROUND(((tm.vol - lm.vol) / NULLIF(lm.vol, 0) * 100)::NUMERIC) AS score
    FROM this_month tm
    JOIN last_month lm ON lm.profile_id = tm.profile_id
    JOIN profiles p ON p.id = tm.profile_id
    WHERE lm.vol > 0
      AND tm.vol > lm.vol
      AND p.leaderboard_visible = TRUE
      AND p.imported_archived = FALSE
    ORDER BY score DESC
    LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_consistency FROM (
    SELECT
      ws.profile_id AS id,
      p.full_name   AS name,
      ROUND((COUNT(DISTINCT date_trunc('day', ws.started_at))::NUMERIC
             / GREATEST(EXTRACT(DAY FROM now())::NUMERIC, 1) * 100))::INT AS score
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id
      AND ws.status = 'completed'
      AND ws.started_at >= date_trunc('month', now())
      AND p.leaderboard_visible = TRUE
      AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    ORDER BY score DESC
    LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_checkins FROM (
    SELECT
      ci.profile_id AS id,
      p.full_name   AS name,
      COUNT(*)::INT AS score
    FROM check_ins ci
    JOIN profiles p ON p.id = ci.profile_id
    WHERE ci.gym_id = v_gym_id
      AND ci.checked_in_at >= v_thirty_ago
      AND p.leaderboard_visible = TRUE
      AND p.imported_archived = FALSE
    GROUP BY ci.profile_id, p.full_name
    ORDER BY score DESC
    LIMIT 10
  ) t;

  -- ── Active challenges + top 10 participants per challenge ─────────────
  -- BUG FIX vs 0423: the participants subquery used `(p->>'score')::NUMERIC`
  -- for ordering, where `p` was a RECORD alias — `->>` only works on
  -- JSON/JSONB. Now ordering by `p.score` directly (record column access)
  -- and aggregating `to_jsonb(p)` so the resulting JSON array preserves the
  -- score-descending order.
  SELECT coalesce(jsonb_agg(c ORDER BY c.start_date ASC), '[]'::JSONB)
  INTO v_challenges
  FROM (
    SELECT
      ch.id,
      ch.name,
      ch.description,
      ch.type,
      ch.start_date,
      ch.end_date,
      ch.reward_description,
      (
        SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.score DESC NULLS LAST), '[]'::JSONB)
        FROM (
          SELECT
            cp.profile_id,
            cp.score,
            pr.full_name AS name,
            pr.avatar_url
          FROM challenge_participants cp
          JOIN profiles pr ON pr.id = cp.profile_id
          WHERE cp.challenge_id = ch.id
            AND cp.gym_id = v_gym_id
            AND pr.imported_archived = false
          ORDER BY cp.score DESC NULLS LAST
          LIMIT 10
        ) p
      ) AS participants
    FROM challenges ch
    WHERE ch.gym_id = v_gym_id
      AND (
        ch.end_date IS NULL
        OR ch.end_date >= now()::DATE
      )
      AND (
        ch.start_date IS NULL
        OR ch.start_date <= (now() + interval '60 days')::DATE
      )
    LIMIT 6
  ) c;

  RETURN jsonb_build_object(
    'success', true,
    'leaderboards', jsonb_build_object(
      'volume',      v_volume,
      'workouts',    v_workouts,
      'prs',         v_prs,
      'improved',    v_improved,
      'consistency', v_consistency,
      'checkins',    v_checkins
    ),
    'challenges', v_challenges
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO anon;

NOTIFY pgrst, 'reload schema';
