-- Allow admins to fetch a member's email from auth.users
-- Email lives in auth.users, not profiles, so we need a SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.admin_get_member_email(p_member_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_gym UUID;
  member_gym UUID;
  member_email TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  caller_gym := public.current_gym_id();

  SELECT gym_id INTO member_gym FROM profiles WHERE id = p_member_id;
  IF member_gym IS NULL OR member_gym != caller_gym THEN
    RAISE EXCEPTION 'Member not found in your gym';
  END IF;

  SELECT email INTO member_email FROM auth.users WHERE id = p_member_id;
  RETURN member_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_member_email(UUID) TO authenticated;
