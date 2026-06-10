-- ============================================================
-- 0523 — get_gym_pulse(): member-visible "who's here today"
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor.
--    Depends on 0493 (profiles.is_staff) being applied first.
--
-- GymPulse (member dashboard card) read workout_sessions + check_ins with
-- a profiles!inner join. Two RLS walls make that impossible for regular
-- members: sessions/check-ins are own-rows-only for members (0002
-- policies: sessions_select_own / checkins_own; only trainers/admins see
-- gym-wide rows), and other members' profiles rows are hidden since 0289
-- (PII protection). Net effect: every member saw ONLY THEMSELVES in
-- "who's here today" — while admins testing in member view saw full data,
-- which masked the bug.
--
-- This SECURITY DEFINER function returns today's gym activity for the
-- CALLER'S OWN gym with safe display fields only:
--   • staff excluded (is_staff, maintained by 0493's trigger)
--   • leaderboard-hidden members excluded (privacy toggle; 0493 forces it
--     false for staff, so this doubles as a staff backstop)
--   • no PII: name + avatar fields only, never email/phone/DOB
--   • time window supplied by the client (device-local "today") but
--     CLAMPED server-side so the function can't be used to scrape
--     historical presence patterns
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_gym_pulse(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id   uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_sessions jsonb;
  v_checkins jsonb;
BEGIN
  -- Caller's gym — auth.uid() is NULL for anon, gym_id NULL pre-onboarding.
  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = auth.uid();
  IF v_gym_id IS NULL THEN
    RETURN jsonb_build_object('sessions', '[]'::jsonb, 'check_ins', '[]'::jsonb);
  END IF;

  -- Clamp: window starts no earlier than 48h ago, runs at most 36h, and
  -- ends no later than 12h from now. Preserves device-local "today"
  -- semantics across timezones without exposing arbitrary history.
  v_start := GREATEST(COALESCE(p_start, date_trunc('day', now())), now() - interval '48 hours');
  v_end   := LEAST(
    COALESCE(p_end, v_start + interval '24 hours'),
    v_start + interval '36 hours',
    now() + interval '12 hours'
  );
  IF v_end <= v_start THEN
    RETURN jsonb_build_object('sessions', '[]'::jsonb, 'check_ins', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_sessions
  FROM (
    SELECT ws.profile_id, ws.status, ws.total_volume_lbs, ws.completed_at, ws.started_at,
           p.full_name, p.avatar_url, p.avatar_type, p.avatar_value
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.gym_id = v_gym_id
      AND ws.started_at >= v_start AND ws.started_at < v_end
      AND p.gym_id = v_gym_id
      AND COALESCE(p.is_staff, false) = false
      AND COALESCE(p.leaderboard_visible, true) = true
    ORDER BY ws.started_at DESC
    LIMIT 500
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_checkins
  FROM (
    SELECT ci.profile_id, ci.checked_in_at,
           p.full_name, p.avatar_url, p.avatar_type, p.avatar_value
    FROM check_ins ci
    JOIN profiles p ON p.id = ci.profile_id
    WHERE ci.gym_id = v_gym_id
      AND ci.checked_in_at >= v_start AND ci.checked_in_at < v_end
      AND p.gym_id = v_gym_id
      AND COALESCE(p.is_staff, false) = false
      AND COALESCE(p.leaderboard_visible, true) = true
    ORDER BY ci.checked_in_at DESC
    LIMIT 500
  ) x;

  RETURN jsonb_build_object('sessions', v_sessions, 'check_ins', v_checkins);
END;
$$;

REVOKE ALL ON FUNCTION public.get_gym_pulse(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gym_pulse(timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
