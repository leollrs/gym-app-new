-- S17: Sync email update to both profiles and auth.users
-- Previously admin could update profiles.email but auth.users.email stayed the same,
-- causing login email and display email to diverge.

CREATE OR REPLACE FUNCTION public.admin_update_member_email(
  p_member_id UUID,
  p_new_email TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id UUID;
  v_caller_role TEXT;
BEGIN
  -- Authorization: must be admin/super_admin
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Gym boundary: admin can only update members of their own gym
  IF v_caller_role = 'admin' THEN
    SELECT gym_id INTO v_gym_id FROM profiles WHERE id = p_member_id;
    IF v_gym_id IS NULL OR v_gym_id != current_gym_id() THEN
      RAISE EXCEPTION 'Member not found in your gym';
    END IF;
  END IF;

  -- Validate email format (basic check)
  IF p_new_email IS NULL OR p_new_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  -- Check email not already in use by another auth user
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(p_new_email) AND id != p_member_id) THEN
    RAISE EXCEPTION 'Email already in use by another account';
  END IF;

  -- Update auth.users email (the login email)
  UPDATE auth.users SET email = lower(p_new_email) WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth user not found';
  END IF;

  -- Update profiles email (the display email)
  UPDATE profiles SET email = lower(p_new_email) WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_member_email(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
