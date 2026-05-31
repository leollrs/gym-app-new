-- 0492_tv_session_revoke.sql
--
-- Per-TV "deactivate" (surgical disconnect of ONE screen), distinct from
-- admin_rotate_tv_code (the nuke that disconnects EVERY TV by changing the code).
--
-- Use case: a single screen got connected somewhere it shouldn't be, or you're
-- decommissioning one TV, or one device's view leaked — kill THAT screen without
-- disrupting the lobby / weight-room / cardio TVs that are running fine.
--
-- Mechanism: a per-session `revoked_at` flag on gym_tv_sessions (NOT on the gym
-- code, so no other TV is affected). The TV's 30s heartbeat (tv_get_dashboard_data)
-- checks it → returns success:false → the TV bounces to the code-entry screen
-- within ≤30s. It is RECONNECTABLE, not a ban: re-entering the code on that TV
-- (tv_authenticate) clears the flag. (To permanently lock everything, rotate.)
--
-- This migration:
--   1. adds gym_tv_sessions.revoked_at
--   2. admin_revoke_tv_session(p_gym_id, p_session_id)  — admin-only, gym-scoped
--   3. tv_get_dashboard_data — reproduces the live 0482 body + a revoked gate
--      (does NOT bump the heartbeat when revoked, so the row goes dark in the
--      admin list immediately)
--   4. tv_authenticate — reproduces the live 0491 body + clears revoked_at on the
--      session upsert (re-entering the code reconnects the TV)
--   5. admin_get_tv_sessions — DROP+recreate (return-type change) to expose
--      revoked_at + treat a revoked row as not-alive
--
-- ⚠️ Apply via Supabase Dashboard SQL Editor.

-- ── 1. Flag column ──────────────────────────────────────────────────────────
ALTER TABLE public.gym_tv_sessions
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.gym_tv_sessions.revoked_at IS
  'Set by admin_revoke_tv_session to disconnect this ONE TV. The TV bounces to the code-entry screen on its next heartbeat. Cleared when the code is re-entered on that device (reconnectable). NULL = active.';

-- ── 2. admin_revoke_tv_session ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revoke_tv_session(
  p_gym_id     UUID,
  p_session_id TEXT
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
  IF p_gym_id <> public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: gym_id mismatch';
  END IF;

  UPDATE gym_tv_sessions
  SET revoked_at = now()
  WHERE gym_id = p_gym_id AND session_id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_tv_session(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_tv_session(UUID, TEXT) TO authenticated;

-- ── 3. tv_get_dashboard_data — live 0482 body + revoked gate ─────────────────
CREATE OR REPLACE FUNCTION public.tv_get_dashboard_data(p_code text, p_session_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings   RECORD;
  v_gym_id     UUID;
  v_revoked    TIMESTAMPTZ;
  v_exists     BOOLEAN;
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

  -- ── Per-session revoke gate ──
  -- If an admin deactivated THIS screen, bounce it (without bumping the
  -- heartbeat, so it reads as not-alive in the admin list immediately).
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
    'leaderboards', jsonb_build_object(
      'volume', v_volume, 'workouts', v_workouts, 'prs', v_prs,
      'improved', v_improved, 'consistency', v_consistency, 'checkins', v_checkins
    ),
    'challenges', v_challenges
  );
END;
$function$;

-- ── 4. tv_authenticate — live 0491 body + clear revoked_at on reconnect ──────
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
  v_ip         TEXT;
  v_fail_count INT;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_required');
  END IF;
  IF p_session_id IS NULL OR length(trim(p_session_id)) < 8 THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_id_required');
  END IF;

  -- Rate-limit gate (per IP, failed attempts only) — see 0491 for rationale.
  v_ip := nullif(left(trim(split_part(
    coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
      current_setting('request.header.x-forwarded-for', true),
      ''
    ), ',', 1)), 45), '');
  IF v_ip IS NOT NULL THEN
    SELECT COUNT(*) INTO v_fail_count
    FROM tv_auth_attempts
    WHERE ip_address = v_ip
      AND attempted_at > now() - interval '15 minutes';
    IF v_fail_count >= 15 THEN
      RETURN jsonb_build_object('success', false, 'error', 'rate_limited');
    END IF;
    IF random() < 0.01 THEN
      DELETE FROM tv_auth_attempts WHERE attempted_at < now() - interval '1 day';
    END IF;
  END IF;

  SELECT * INTO v_settings FROM gym_tv_settings
  WHERE code = upper(trim(p_code));

  IF NOT FOUND THEN
    IF v_ip IS NOT NULL THEN
      INSERT INTO tv_auth_attempts (ip_address) VALUES (v_ip);
    END IF;
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

  -- Register / refresh the session. Re-entering the code CLEARS any admin
  -- revoke on this device (reconnect) — that's the intended "kick, not ban".
  INSERT INTO gym_tv_sessions (gym_id, session_id, user_agent)
  VALUES (v_gym.id, p_session_id, p_user_agent)
  ON CONFLICT (gym_id, session_id) DO UPDATE
    SET last_heartbeat_at = now(),
        user_agent = COALESCE(EXCLUDED.user_agent, gym_tv_sessions.user_agent),
        revoked_at = NULL;

  RETURN jsonb_build_object(
    'success',       true,
    'gym_id',        v_gym.id,
    'gym_name',      v_gym.name,
    'gym_slug',      v_gym.slug,
    'gym_timezone',  v_gym.timezone,
    'accent_color',  v_accent,
    'primary_color', v_primary,
    'logo_url',      v_logo_url,
    'tv_style',      v_settings.tv_style
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO anon;

-- ── 5. admin_get_tv_sessions — expose revoked_at + revoked ⇒ not alive ───────
-- Return-type change (new column) requires DROP first (CREATE OR REPLACE can't
-- change a function's return type — the 42P13 error).
DROP FUNCTION IF EXISTS public.admin_get_tv_sessions(UUID);

CREATE FUNCTION public.admin_get_tv_sessions(p_gym_id UUID)
RETURNS TABLE (
  session_id        TEXT,
  connected_at      TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  user_agent        TEXT,
  is_alive          BOOLEAN,
  revoked_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
  IF p_gym_id <> public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: gym_id mismatch';
  END IF;

  RETURN QUERY
  SELECT
    s.session_id,
    s.connected_at,
    s.last_heartbeat_at,
    s.user_agent,
    -- A revoked TV is never "alive" even if its last heartbeat was recent.
    (s.revoked_at IS NULL AND s.last_heartbeat_at > (now() - interval '2 minutes')) AS is_alive,
    s.revoked_at
  FROM gym_tv_sessions s
  WHERE s.gym_id = p_gym_id
    AND s.last_heartbeat_at > (now() - interval '10 minutes')
  ORDER BY s.last_heartbeat_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_tv_sessions(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
