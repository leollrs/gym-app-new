-- 0558_add_friend_by_code.sql
-- ----------------------------------------------------------------------------
-- Add-friend-by-code (the /add-friend/<code> deep link) — server-side.
--
-- Migration 0289 tightened `profiles_select` so a REGULAR member can only read
-- their own profiles row (admins/trainers see same-gym). That broke the
-- client-side friend_code lookup: looking up ANOTHER member's row by
-- friend_code returned null → the app showed "friend code not found" even for
-- a valid same-gym code.
--
-- This SECURITY DEFINER RPC runs the whole operation as the table owner (so it
-- can resolve the code regardless of profiles_select), while enforcing the
-- same-gym boundary itself. Because it can see every gym, it can also tell
-- "code belongs to another gym" apart from "code doesn't exist".
--
-- Returns JSONB { status, name? } where status ∈
--   sent | already | self | not_same_gym | not_found | not_authenticated
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_friend_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       UUID := auth.uid();
  v_caller_gym   UUID;
  v_target       UUID;
  v_target_gym   UUID;
  v_target_name  TEXT;
  v_exists       INT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF p_code IS NULL OR length(btrim(p_code)) = 0 THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT gym_id INTO v_caller_gym FROM public.profiles WHERE id = v_caller;

  SELECT id, gym_id, full_name
    INTO v_target, v_target_gym, v_target_name
  FROM public.profiles
  WHERE friend_code = btrim(p_code)
  LIMIT 1;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_target = v_caller THEN
    RETURN jsonb_build_object('status', 'self');
  END IF;

  -- Friends are gym-scoped.
  IF v_target_gym IS DISTINCT FROM v_caller_gym THEN
    RETURN jsonb_build_object('status', 'not_same_gym');
  END IF;

  SELECT 1 INTO v_exists
  FROM public.friendships
  WHERE (requester_id = v_caller AND addressee_id = v_target)
     OR (requester_id = v_target AND addressee_id = v_caller)
  LIMIT 1;

  IF v_exists IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already');
  END IF;

  INSERT INTO public.friendships (requester_id, addressee_id, gym_id, status)
  VALUES (v_caller, v_target, v_caller_gym, 'pending');

  RETURN jsonb_build_object('status', 'sent', 'name', v_target_name);
END;
$$;

REVOKE ALL ON FUNCTION public.add_friend_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_friend_by_code(TEXT) TO authenticated;

COMMENT ON FUNCTION public.add_friend_by_code(TEXT) IS
  'Resolve a profiles.friend_code within the caller''s gym and create a pending '
  'friendship. SECURITY DEFINER so it works despite the profiles_select PII '
  'lockdown from migration 0289. Returns jsonb { status, name? }.';
