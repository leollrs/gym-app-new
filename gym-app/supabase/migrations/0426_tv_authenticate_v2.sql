-- ============================================================================
-- 0426: tv_authenticate v2 — fix gym name, return primary color + timezone
--
-- Multiple issues caught while testing the TV display:
--
--  1. Gym name shown was the gym_branding.custom_app_name (TuGymPR white-
--     label override), not the actual gym.name. The TV header should show
--     the gym's REAL name to the members standing in front of it, not the
--     vendor brand name.
--
--  2. Only accent_color was being passed — no primary_color, so the TV
--     UI couldn't theme its backgrounds/borders properly.
--
--  3. The clock was rendered with the BROWSER's local time. For a TV
--     running on a generic media stick that has its clock wrong, or a
--     gym in a different timezone than where the stick was set up, this
--     reads wrong. Now returning gym.timezone so the client can format
--     the clock in the gym's local time regardless of the device clock.
-- ============================================================================

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

  -- Pull the real gym row including timezone for the TV clock.
  SELECT id, name, slug, is_active, timezone INTO v_gym
  FROM gyms WHERE id = v_settings.gym_id;
  IF NOT v_gym.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'gym_inactive');
  END IF;

  -- Branding scalars — separate so a missing branding row doesn't blow up
  -- field access on a RECORD. Both colors returned so the TV client can
  -- theme backgrounds + accents instead of just highlights.
  SELECT accent_color, primary_color, logo_url
    INTO v_accent, v_primary, v_logo_url
  FROM gym_branding WHERE gym_id = v_gym.id;

  -- Register / refresh the session row so the admin sees the count.
  INSERT INTO gym_tv_sessions (gym_id, session_id, user_agent)
  VALUES (v_gym.id, p_session_id, p_user_agent)
  ON CONFLICT (gym_id, session_id) DO UPDATE
    SET last_heartbeat_at = now(),
        user_agent = COALESCE(EXCLUDED.user_agent, gym_tv_sessions.user_agent);

  RETURN jsonb_build_object(
    'success',       true,
    'gym_id',        v_gym.id,
    -- The REAL gym name — not the vendor-brand override. Members in the
    -- lobby need to see their gym's name.
    'gym_name',      v_gym.name,
    'gym_slug',      v_gym.slug,
    -- Gym's IANA timezone (e.g. "America/Puerto_Rico"). The TV client
    -- formats its clock via Intl.DateTimeFormat with this string, so the
    -- displayed time is correct regardless of what the TV's system clock
    -- or timezone is set to.
    'gym_timezone',  v_gym.timezone,
    'accent_color',  v_accent,
    'primary_color', v_primary,
    'logo_url',      v_logo_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_authenticate(TEXT, TEXT, TEXT) TO anon;

NOTIFY pgrst, 'reload schema';
