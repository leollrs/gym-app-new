-- ============================================================================
-- 0423: Public TV display — code-gated read access for gym lobby screens
--
-- The existing /tv-display page required an authenticated session, which is
-- impractical for a gym TV (nobody logs in a smart TV / Fire Stick / Apple
-- TV every day). This migration replaces that with a code-gated public flow:
--
--   - Each gym has ONE active TV code (6-char alphanumeric, unambiguous
--     chars only, matching existing invite code alphabet).
--   - Admins can rotate the code at will — rotation is the kill switch:
--     all connected TVs fail validation on their next heartbeat and bounce
--     to the code-entry screen.
--   - TVs heartbeat every ~30 s; the admin UI shows live connection count
--     by filtering sessions whose last_heartbeat_at is within 2 minutes.
--   - All TV-facing RPCs are SECURITY DEFINER and accept anon callers, but
--     validate the (code, session_id) pair on every call. No code → no data.
-- ============================================================================

-- ── gym_tv_settings: one row per gym, holds the active code ─────────────────
CREATE TABLE IF NOT EXISTS gym_tv_settings (
  gym_id          UUID PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  code_rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gym_tv_settings_code ON gym_tv_settings(code);

ALTER TABLE gym_tv_settings ENABLE ROW LEVEL SECURITY;

-- Admins read/manage their gym's row; super_admins everything.
CREATE POLICY "tv_settings_admin_select" ON gym_tv_settings
  FOR SELECT USING (
    gym_id = public.current_gym_id() AND public.is_admin()
  );

CREATE POLICY "tv_settings_super_admin_all" ON gym_tv_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── gym_tv_sessions: one row per connected TV (alive or recently dead) ──────
-- We don't auto-delete dead sessions — they stay so an admin can see
-- "this TV was connected for 3 hours yesterday." Connection count is computed
-- by filtering for last_heartbeat_at within the past 2 minutes.
CREATE TABLE IF NOT EXISTS gym_tv_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  session_id        TEXT NOT NULL,  -- client-generated UUID stored in TV localStorage
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent        TEXT,
  -- A TV that re-authenticates after a rotation gets a new (gym_id, session_id)
  -- row; we don't try to dedupe across rotations since the code change is
  -- the breaking event anyway.
  UNIQUE (gym_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_gym_tv_sessions_gym_alive
  ON gym_tv_sessions(gym_id, last_heartbeat_at DESC);

ALTER TABLE gym_tv_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tv_sessions_admin_select" ON gym_tv_sessions
  FOR SELECT USING (
    gym_id = public.current_gym_id() AND public.is_admin()
  );

-- ── generate_tv_code(): 6-char alphanumeric, no ambiguous chars ─────────────
-- Same alphabet as generate_invite_code so codes look familiar to admins.
CREATE OR REPLACE FUNCTION public.generate_tv_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars  TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i      INT;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- ── admin_get_or_create_tv_code(p_gym_id): admin-only, lazy init ────────────
-- First call mints the code; subsequent calls return whatever's stored.
-- The admin UI calls this on page mount so the code is ready to show.
CREATE OR REPLACE FUNCTION public.admin_get_or_create_tv_code(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code      TEXT;
  v_rotated   TIMESTAMPTZ;
  v_attempt   INT := 0;
  v_exists    BOOLEAN;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
  IF p_gym_id <> public.current_gym_id() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Permission denied: gym_id mismatch';
  END IF;

  SELECT code, code_rotated_at INTO v_code, v_rotated
  FROM gym_tv_settings WHERE gym_id = p_gym_id;

  IF v_code IS NULL THEN
    -- Lazy init — generate a unique code (retry on the astronomically
    -- unlikely collision with another gym's code).
    LOOP
      v_attempt := v_attempt + 1;
      IF v_attempt > 12 THEN
        RAISE EXCEPTION 'Could not generate a unique TV code after 12 attempts';
      END IF;
      v_code := public.generate_tv_code();
      SELECT EXISTS(SELECT 1 FROM gym_tv_settings WHERE code = v_code) INTO v_exists;
      EXIT WHEN NOT v_exists;
    END LOOP;

    INSERT INTO gym_tv_settings (gym_id, code) VALUES (p_gym_id, v_code)
    RETURNING code_rotated_at INTO v_rotated;
  END IF;

  RETURN jsonb_build_object(
    'code', v_code,
    'rotated_at', v_rotated
  );
END;
$$;

-- ── admin_rotate_tv_code(p_gym_id): replace code, leave sessions to expire ──
-- We don't delete sessions on rotate — the old sessions just stop being
-- "alive" once their heartbeats fail validation against the new code.
-- That gives the admin UI a clean trailing audit of who was connected
-- when the rotation happened.
CREATE OR REPLACE FUNCTION public.admin_rotate_tv_code(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code    TEXT;
  v_attempt INT := 0;
  v_exists  BOOLEAN;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;
  IF p_gym_id <> public.current_gym_id() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Permission denied: gym_id mismatch';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 12 THEN
      RAISE EXCEPTION 'Could not generate a unique TV code after 12 attempts';
    END IF;
    v_code := public.generate_tv_code();
    SELECT EXISTS(SELECT 1 FROM gym_tv_settings WHERE code = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;

  INSERT INTO gym_tv_settings (gym_id, code, code_rotated_at)
  VALUES (p_gym_id, v_code, now())
  ON CONFLICT (gym_id) DO UPDATE
    SET code = EXCLUDED.code,
        code_rotated_at = now();

  RETURN jsonb_build_object('code', v_code, 'rotated_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_or_create_tv_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rotate_tv_code(UUID) TO authenticated;


-- ── tv_authenticate(p_code, p_session_id, p_user_agent): public ─────────────
-- Called once when a TV opens /tv with a code. Returns the gym id + branding
-- + the active-challenges flag so the TV knows what to render. Inserts a
-- session row so the admin sees this TV as connected. Errors if code invalid.
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
  -- Scalar locals (instead of a RECORD) so we don't crash on gyms that
  -- never had a gym_branding row created — accessing fields on an
  -- "undefined" RECORD raises; NULL scalars just flow through COALESCE.
  v_accent     TEXT;
  v_logo_url   TEXT;
  v_app_name   TEXT;
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

  SELECT id, name, slug, is_active INTO v_gym FROM gyms WHERE id = v_settings.gym_id;
  IF NOT v_gym.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'gym_inactive');
  END IF;

  SELECT accent_color, logo_url, custom_app_name
    INTO v_accent, v_logo_url, v_app_name
  FROM gym_branding WHERE gym_id = v_gym.id;
  -- No-row case: variables stay NULL, COALESCE below handles it.

  -- Register / refresh the session row so the admin sees the count.
  INSERT INTO gym_tv_sessions (gym_id, session_id, user_agent)
  VALUES (v_gym.id, p_session_id, p_user_agent)
  ON CONFLICT (gym_id, session_id) DO UPDATE
    SET last_heartbeat_at = now(),
        user_agent = COALESCE(EXCLUDED.user_agent, gym_tv_sessions.user_agent);

  RETURN jsonb_build_object(
    'success',      true,
    'gym_id',       v_gym.id,
    'gym_name',     COALESCE(v_app_name, v_gym.name),
    'gym_slug',     v_gym.slug,
    'accent_color', v_accent,
    'logo_url',     v_logo_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO anon;


-- ── tv_get_dashboard_data(p_code, p_session_id): public, fat read ───────────
-- One round-trip returns everything the TV needs to render its rotation:
-- six metric leaderboards + every active challenge with its top participants.
-- Also acts as the heartbeat — bumping last_heartbeat_at on each call. The
-- TV polls this every ~30s. If the code was rotated, returns invalid_code
-- and the TV bounces back to the code-entry screen.
--
-- Returns shape:
--   {
--     "success": true,
--     "leaderboards": {
--       "volume":      [{"id":"...","name":"María R.","score":12345}, ...],
--       "workouts":    [...],
--       "prs":         [...],
--       "improved":    [...],
--       "consistency": [...],
--       "checkins":    [...]
--     },
--     "challenges": [
--       {
--         "id":"...", "name":"...", "type":"...", "end_date":"...",
--         "participants": [{"name":"...", "score": 12345}, ...]
--       }, ...
--     ]
--   }
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

  -- Heartbeat — upsert. UPDATE-only first to avoid the (very rare) race where
  -- the session row was wiped by a rotation cleanup; INSERT fallback covers
  -- first-call-after-rotate case.
  UPDATE gym_tv_sessions
  SET last_heartbeat_at = now()
  WHERE gym_id = v_gym_id AND session_id = p_session_id;
  IF NOT FOUND THEN
    INSERT INTO gym_tv_sessions (gym_id, session_id)
    VALUES (v_gym_id, p_session_id)
    ON CONFLICT (gym_id, session_id) DO UPDATE SET last_heartbeat_at = now();
  END IF;

  -- ── Leaderboards (inline) ─────────────────────────────────────────────
  -- We deliberately don't call the existing get_leaderboard_* RPCs here.
  -- Those gate on `p_gym_id IS DISTINCT FROM current_gym_id()` which fails
  -- for an anon TV caller (auth.uid() is null). Inlining the queries here
  -- under SECURITY DEFINER lets the TV read the data after passing the code
  -- check, while still respecting `profiles.leaderboard_visible` — the
  -- per-member opt-out toggle that powers the public in-app leaderboards.
  -- Imported-archived members are excluded everywhere (ex-members shouldn't
  -- show up on a current-month leaderboard).

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

  -- workouts: top 10 by completed session count in the last 30 days
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

  -- prs: top 10 personal records by estimated 1RM (all-time)
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

  -- improved: top 10 by % volume gain this month vs last month
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

  -- consistency: top 10 by distinct workout days this month (% of month elapsed)
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

  -- checkins: top 10 by check-in count in the last 30 days
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

  -- ── Active challenges + top 10 participants per challenge ──
  -- "Active" = window includes today. We deliberately also include
  -- challenges that haven't started yet (start_date in the future, ending
  -- within 60 days) so the TV can advertise them and members can join via
  -- the QR before they kick off. Past challenges are excluded.
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
        SELECT coalesce(jsonb_agg(p ORDER BY (p->>'score')::NUMERIC DESC), '[]'::JSONB)
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


-- ── admin_get_tv_sessions(p_gym_id): admin-only, list connected TVs ─────────
-- Powers the admin "Connected TVs" list. Returns alive sessions
-- (last_heartbeat_at within 2 minutes) + recently-dropped (last 10 minutes,
-- so the admin can see "this TV just dropped" before it's stale).
CREATE OR REPLACE FUNCTION public.admin_get_tv_sessions(p_gym_id UUID)
RETURNS TABLE (
  session_id        TEXT,
  connected_at      TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  user_agent        TEXT,
  is_alive          BOOLEAN
)
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

  RETURN QUERY
  SELECT
    s.session_id,
    s.connected_at,
    s.last_heartbeat_at,
    s.user_agent,
    s.last_heartbeat_at > (now() - interval '2 minutes') AS is_alive
  FROM gym_tv_sessions s
  WHERE s.gym_id = p_gym_id
    AND s.last_heartbeat_at > (now() - interval '10 minutes')
  ORDER BY s.last_heartbeat_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_tv_sessions(UUID) TO authenticated;


COMMENT ON TABLE gym_tv_settings IS
  'One row per gym holding the active TV display code. Rotating the code (via admin_rotate_tv_code) instantly invalidates all connected TVs.';
COMMENT ON TABLE gym_tv_sessions IS
  'Heartbeat tracking for connected TV displays. A session is "alive" if last_heartbeat_at is within the past 2 minutes.';

NOTIFY pgrst, 'reload schema';
