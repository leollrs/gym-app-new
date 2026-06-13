-- 0563_add_friend_by_code_autoadd.sql
-- ----------------------------------------------------------------------------
-- Add-friend-by-code now AUTO-ADDS (instant mutual friendship) instead of
-- sending a pending request. Adding someone via their shared code/link is
-- explicit mutual consent (they handed you the code), so it should connect you
-- immediately — like Snapchat add-by-username. Supersedes 0558's 'pending'.
--
-- Behavior:
--   • No existing relationship  → INSERT status='accepted'   → 'added'
--   • Existing PENDING (either)  → UPDATE to 'accepted'        → 'added'
--   • Existing ACCEPTED          → 'already' (already friends)
-- Returns JSONB { status, name? } where status ∈
--   added | already | self | not_same_gym | not_found | not_authenticated
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
  v_status       TEXT;
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

  -- Existing relationship in either direction?
  SELECT status INTO v_status
  FROM public.friendships
  WHERE (requester_id = v_caller AND addressee_id = v_target)
     OR (requester_id = v_target AND addressee_id = v_caller)
  LIMIT 1;

  IF v_status = 'accepted' THEN
    RETURN jsonb_build_object('status', 'already', 'name', v_target_name);
  ELSIF v_status IS NOT NULL THEN
    -- A pending request already exists either way — adding by code is explicit
    -- mutual consent, so consummate it immediately.
    UPDATE public.friendships
       SET status = 'accepted'
     WHERE (requester_id = v_caller AND addressee_id = v_target)
        OR (requester_id = v_target AND addressee_id = v_caller);
    RETURN jsonb_build_object('status', 'added', 'name', v_target_name);
  END IF;

  INSERT INTO public.friendships (requester_id, addressee_id, gym_id, status)
  VALUES (v_caller, v_target, v_caller_gym, 'accepted');

  RETURN jsonb_build_object('status', 'added', 'name', v_target_name);
END;
$$;

REVOKE ALL ON FUNCTION public.add_friend_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_friend_by_code(TEXT) TO authenticated;

COMMENT ON FUNCTION public.add_friend_by_code(TEXT) IS
  'Resolve a profiles.friend_code within the caller''s gym and create an '
  'ACCEPTED friendship immediately (auto-add), consummating any existing '
  'pending request. SECURITY DEFINER (works despite the 0289 profiles_select '
  'PII lockdown). Returns jsonb { status, name? }.';
