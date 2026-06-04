-- ============================================================================
-- 0518: TV leaderboard time-range selection
--
-- Admins can pick the window the TV's count-based leaderboards use:
--   today | week | month (30d) | 90d | all
--
-- Applies to the three "who did the most" boards — Volume, Workouts,
-- Check-ins — which are pure time windows. The other three keep their
-- intrinsic semantics: PRs are all-time records, Most Improved is a
-- month-over-month delta, Consistency is a this-month rate.
--
-- Stored on gym_tv_settings alongside tv_style (one choice per gym, shared
-- by every screen) and echoed back on every tv_get_dashboard_data heartbeat
-- so live TVs pick up changes within 30s without a reload.
-- ============================================================================

ALTER TABLE gym_tv_settings
  ADD COLUMN IF NOT EXISTS tv_period TEXT NOT NULL DEFAULT 'month'
    CHECK (tv_period IN ('today', 'week', 'month', '90d', 'all'));

COMMENT ON COLUMN gym_tv_settings.tv_period IS
  'Window for the TV count-based leaderboards (Volume/Workouts/Check-ins): today | week | month(30d) | 90d | all. Admin picks via /admin/tv-setup.';


-- ── admin_set_tv_period ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_tv_period(
  p_gym_id UUID,
  p_period TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
  IF p_gym_id <> public.current_gym_id() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Permission denied: gym_id mismatch';
  END IF;
  IF p_period NOT IN ('today', 'week', 'month', '90d', 'all') THEN
    RAISE EXCEPTION 'Invalid period: must be today, week, month, 90d, or all';
  END IF;

  INSERT INTO gym_tv_settings (gym_id, code, tv_period)
  VALUES (p_gym_id, public.generate_tv_code(), p_period)
  ON CONFLICT (gym_id) DO UPDATE
    SET tv_period = EXCLUDED.tv_period;

  RETURN jsonb_build_object('success', true, 'period', p_period);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_tv_period(UUID, TEXT) TO authenticated;


-- ── tv_get_dashboard_data — period-aware window for Volume/Workouts/Check-ins ─
-- Based verbatim on the 0492 body (revoke gate + heartbeat + all 6 boards +
-- challenges); only the windowed-metric date floor changes from a fixed 30d to
-- the gym's chosen period, and tv_period is added to the response.
CREATE OR REPLACE FUNCTION public.tv_get_dashboard_data(p_code text, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings    RECORD;
  v_gym_id      UUID;
  v_revoked     TIMESTAMPTZ;
  v_exists      BOOLEAN;
  v_period      TEXT;
  v_since       TIMESTAMPTZ;
  v_volume      JSONB;
  v_workouts    JSONB;
  v_prs         JSONB;
  v_improved    JSONB;
  v_consistency JSONB;
  v_checkins    JSONB;
  v_challenges  JSONB;
BEGIN
  SELECT * INTO v_settings FROM gym_tv_settings WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;
  v_gym_id := v_settings.gym_id;

  -- Chosen window for the count-based boards.
  v_period := COALESCE(v_settings.tv_period, 'month');
  v_since := CASE v_period
    WHEN 'today' THEN date_trunc('day', now())
    WHEN 'week'  THEN now() - interval '7 days'
    WHEN 'month' THEN now() - interval '30 days'
    WHEN '90d'   THEN now() - interval '90 days'
    WHEN 'all'   THEN 'epoch'::timestamptz
    ELSE now() - interval '30 days'
  END;

  -- ── Per-session revoke gate ──
  SELECT revoked_at INTO v_revoked
  FROM gym_tv_sessions
  WHERE gym_id = v_gym_id AND session_id = p_session_id;
  v_exists := FOUND;
  IF v_exists AND v_revoked IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'revoked');
  END IF;

  -- Heartbeat (only for non-revoked sessions).
  IF v_exists THEN
    UPDATE gym_tv_sessions
    SET last_heartbeat_at = now()
    WHERE gym_id = v_gym_id AND session_id = p_session_id;
  ELSE
    INSERT INTO gym_tv_sessions (gym_id, session_id)
    VALUES (v_gym_id, p_session_id)
    ON CONFLICT (gym_id, session_id) DO UPDATE SET last_heartbeat_at = now();
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_volume FROM (
    SELECT ws.profile_id AS id, p.full_name AS name,
           ROUND(SUM(ws.total_volume_lbs)::NUMERIC) AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_since
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    HAVING SUM(ws.total_volume_lbs) > 0
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_workouts FROM (
    SELECT ws.profile_id AS id, p.full_name AS name, COUNT(*)::INT AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_since
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_prs FROM (
    SELECT pr.profile_id AS id, p.full_name AS name,
           ROUND(MAX(pr.estimated_1rm)::NUMERIC) AS score
    FROM personal_records pr JOIN profiles p ON p.id = pr.profile_id
    WHERE p.gym_id = v_gym_id
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY pr.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_improved FROM (
    WITH this_month AS (
      SELECT ws.profile_id, SUM(ws.total_volume_lbs) AS vol
      FROM workout_sessions ws
      WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
        AND ws.started_at >= date_trunc('month', now())
      GROUP BY ws.profile_id
    ), last_month AS (
      SELECT ws.profile_id, SUM(ws.total_volume_lbs) AS vol
      FROM workout_sessions ws
      WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
        AND ws.started_at >= date_trunc('month', now() - interval '1 month')
        AND ws.started_at <  date_trunc('month', now())
      GROUP BY ws.profile_id
    )
    SELECT tm.profile_id AS id, p.full_name AS name,
           ROUND(((tm.vol - lm.vol) / NULLIF(lm.vol, 0) * 100)::NUMERIC) AS score
    FROM this_month tm JOIN last_month lm ON lm.profile_id = tm.profile_id
    JOIN profiles p ON p.id = tm.profile_id
    WHERE lm.vol > 0 AND tm.vol > lm.vol
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_consistency FROM (
    SELECT ws.profile_id AS id, p.full_name AS name,
           ROUND((COUNT(DISTINCT date_trunc('day', ws.started_at))::NUMERIC
             / GREATEST(EXTRACT(DAY FROM now())::NUMERIC, 1) * 100))::INT AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= date_trunc('month', now())
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_checkins FROM (
    SELECT ci.profile_id AS id, p.full_name AS name, COUNT(*)::INT AS score
    FROM check_ins ci JOIN profiles p ON p.id = ci.profile_id
    WHERE ci.gym_id = v_gym_id AND ci.checked_in_at >= v_since
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ci.profile_id, p.full_name
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(c ORDER BY c.start_date ASC), '[]'::JSONB)
  INTO v_challenges FROM (
    SELECT ch.id, ch.name, ch.description, ch.type,
           ch.start_date, ch.end_date, ch.reward_description,
      (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.score DESC NULLS LAST), '[]'::JSONB)
        FROM (
          SELECT cp.profile_id, cp.score, pr.full_name AS name, pr.avatar_url
          FROM challenge_participants cp JOIN profiles pr ON pr.id = cp.profile_id
          WHERE cp.challenge_id = ch.id AND cp.gym_id = v_gym_id
            AND pr.imported_archived = false
            AND pr.leaderboard_visible = TRUE
          ORDER BY cp.score DESC NULLS LAST LIMIT 10
        ) p
      ) AS participants
    FROM challenges ch
    WHERE ch.gym_id = v_gym_id
      AND (ch.end_date IS NULL OR ch.end_date >= now()::DATE)
      AND (ch.start_date IS NULL OR ch.start_date <= (now() + interval '60 days')::DATE)
    LIMIT 6
  ) c;

  RETURN jsonb_build_object(
    'success', true,
    'tv_style', v_settings.tv_style,
    'tv_period', v_period,
    'leaderboards', jsonb_build_object(
      'volume', v_volume, 'workouts', v_workouts, 'prs', v_prs,
      'improved', v_improved, 'consistency', v_consistency, 'checkins', v_checkins
    ),
    'challenges', v_challenges
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO anon;

NOTIFY pgrst, 'reload schema';
