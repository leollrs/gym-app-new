-- Add p_gym_id parameter to broadcast_notification for defense-in-depth.
-- The function still validates that p_gym_id matches the caller's gym,
-- but requiring it from the client prevents accidental cross-gym broadcasts
-- if current_gym_id() ever returns NULL or an unexpected value.

-- Drop the old 3-arg signature so we can replace with 4-arg
DROP FUNCTION IF EXISTS public.broadcast_notification(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.broadcast_notification(
  p_gym_id UUID,
  p_title  TEXT,
  p_body   TEXT,
  p_type   TEXT DEFAULT 'announcement'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_gym UUID;
  inserted_count INT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  caller_gym := public.current_gym_id();

  -- Defense-in-depth: verify client-supplied gym matches caller's gym
  IF p_gym_id IS NULL OR p_gym_id != caller_gym THEN
    RAISE EXCEPTION 'Gym ID mismatch: supplied % but caller belongs to %', p_gym_id, caller_gym;
  END IF;

  INSERT INTO notifications (profile_id, gym_id, title, body, type)
  SELECT p.id, caller_gym, p_title, p_body, p_type::notification_type
  FROM profiles p
  WHERE p.gym_id = caller_gym AND p.role = 'member';

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.broadcast_notification(UUID, TEXT, TEXT, TEXT) TO authenticated;
