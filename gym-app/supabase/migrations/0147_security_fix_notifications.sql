-- Allow admins to broadcast notifications to all gym members
CREATE OR REPLACE FUNCTION public.broadcast_notification(
  p_title TEXT,
  p_body TEXT,
  p_type TEXT DEFAULT 'announcement'
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

  INSERT INTO notifications (profile_id, title, body, type)
  SELECT p.id, p_title, p_body, p_type
  FROM profiles p
  WHERE p.gym_id = caller_gym AND p.role = 'member';

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.broadcast_notification(TEXT, TEXT, TEXT) TO authenticated;
