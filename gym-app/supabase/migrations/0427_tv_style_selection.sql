-- ============================================================================
-- 0427: TV display style selection
--
-- Admins can pick one of 4 visual styles for their gym's TV display:
--   - stadium    (V1: Dark Stadium - ESPN/Crossfit big board, podium hero)
--   - brutal     (V2: Brutalist Board - cream+ink editorial scoreboard)
--   - boricua    (V3: Boricua Heat - tropical sunset, podium columns)
--   - telemetry  (V4: Live Telemetry - mission-control monospace)
--
-- The style is stored on `gym_tv_settings` so it lives alongside the gym's
-- TV code and survives code rotation. Every TV display in the gym shares
-- the same style — admins switch globally, not per-screen.
--
-- The choice is returned from `tv_authenticate` (for first paint) and
-- `tv_get_dashboard_data` (so live TVs pick up changes on the next 30s
-- heartbeat without a manual reload).
-- ============================================================================

ALTER TABLE gym_tv_settings
  ADD COLUMN IF NOT EXISTS tv_style TEXT NOT NULL DEFAULT 'stadium'
    CHECK (tv_style IN ('stadium', 'brutal', 'boricua', 'telemetry'));

COMMENT ON COLUMN gym_tv_settings.tv_style IS
  'TV display visual theme. Members on the gym floor see this style across all 6 leaderboard slides and challenge slides. Admin picks via /admin/tv-setup.';


-- ── admin_set_tv_style ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_tv_style(
  p_gym_id UUID,
  p_style  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
  IF p_gym_id <> public.current_gym_id() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Permission denied: gym_id mismatch';
  END IF;
  IF p_style NOT IN ('stadium', 'brutal', 'boricua', 'telemetry') THEN
    RAISE EXCEPTION 'Invalid style: must be stadium, brutal, boricua, or telemetry';
  END IF;

  -- Upsert — if the gym hasn't generated a TV code yet, we still want the
  -- style to stick so it applies as soon as they generate one. Generate a
  -- placeholder code via the helper if missing.
  INSERT INTO gym_tv_settings (gym_id, code, tv_style)
  VALUES (p_gym_id, public.generate_tv_code(), p_style)
  ON CONFLICT (gym_id) DO UPDATE
    SET tv_style = EXCLUDED.tv_style;

  RETURN jsonb_build_object('success', true, 'style', p_style);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_tv_style(UUID, TEXT) TO authenticated;


-- ── Update tv_authenticate to return the current style ─────────────────────
CREATE OR REPLACE FUNCTION public.tv_authenticate(
  p_code       TEXT,
  p_session_id TEXT,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings   RECORD;
  v_gym        RECORD;
  v_accent     TEXT;
  v_primary    TEXT;
  v_logo_url   TEXT;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_required');
  END IF;
  IF p_session_id IS NULL OR length(trim(p_session_id)) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_id_required');
  END IF;

  SELECT * INTO v_settings FROM gym_tv_settings
  WHERE code = upper(trim(p_code));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_code');
  END IF;

  SELECT id, name, slug, is_active, timezone INTO v_gym
  FROM gyms WHERE id = v_settings.gym_id;
  IF NOT v_gym.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'gym_inactive');
  END IF;

  SELECT accent_color, primary_color, logo_url
    INTO v_accent, v_primary, v_logo_url
  FROM gym_branding WHERE gym_id = v_gym.id;

  INSERT INTO gym_tv_sessions (gym_id, session_id, user_agent)
  VALUES (v_gym.id, p_session_id, p_user_agent)
  ON CONFLICT (gym_id, session_id) DO UPDATE
    SET last_heartbeat_at = now(),
        user_agent = COALESCE(EXCLUDED.user_agent, gym_tv_sessions.user_agent);

  RETURN jsonb_build_object(
    'success',       true,
    'gym_id',        v_gym.id,
    'gym_name',      v_gym.name,
    'gym_slug',      v_gym.slug,
    'gym_timezone',  v_gym.timezone,
    'accent_color',  v_accent,
    'primary_color', v_primary,
    'logo_url',      v_logo_url,
    -- NEW in 0427: style choice. Defaults to 'stadium' via column default.
    'tv_style',      v_settings.tv_style
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO anon;


-- ── tv_get_dashboard_data: also returns the current style on every fetch ──
-- So live TVs that don't reload still pick up admin style changes on their
-- next 30s heartbeat. The function body is otherwise identical to 0425.
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

  UPDATE gym_tv_sessions
  SET last_heartbeat_at = now()
  WHERE gym_id = v_gym_id AND session_id = p_session_id;
  IF NOT FOUND THEN
    INSERT INTO gym_tv_sessions (gym_id, session_id)
    VALUES (v_gym_id, p_session_id)
    ON CONFLICT (gym_id, session_id) DO UPDATE SET last_heartbeat_at = now();
  END IF;

  -- Leaderboards (identical to 0425) ──────────────────────────────────────
  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_volume FROM (
    SELECT ws.profile_id AS id, p.full_name AS name,
           ROUND(SUM(ws.total_volume_lbs)::NUMERIC) AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_thirty_ago
      AND p.leaderboard_visible = TRUE AND p.imported_archived = FALSE
    GROUP BY ws.profile_id, p.full_name
    HAVING SUM(ws.total_volume_lbs) > 0
    ORDER BY score DESC LIMIT 10
  ) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_workouts FROM (
    SELECT ws.profile_id AS id, p.full_name AS name, COUNT(*)::INT AS score
    FROM workout_sessions ws JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id AND ws.status = 'completed'
      AND ws.started_at >= v_thirty_ago
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
    WHERE ci.gym_id = v_gym_id AND ci.checked_in_at >= v_thirty_ago
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
    'tv_style', v_settings.tv_style,  -- NEW: lets live TVs pick up style changes on heartbeat
    'leaderboards', jsonb_build_object(
      'volume', v_volume, 'workouts', v_workouts, 'prs', v_prs,
      'improved', v_improved, 'consistency', v_consistency, 'checkins', v_checkins
    ),
    'challenges', v_challenges
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_get_dashboard_data(TEXT, TEXT) TO anon;

NOTIFY pgrst, 'reload schema';
