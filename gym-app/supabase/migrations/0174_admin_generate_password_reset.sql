-- ============================================================
-- 0174: Admin-Initiated Password Reset
-- Allows admins to generate a 6-digit reset code for a member
-- without requiring the member to initiate the request.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_generate_password_reset(p_profile_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_gym_id UUID;
  v_code TEXT;
BEGIN
  -- Only admins can call this
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  -- Look up the member's email and gym
  SELECT u.email, p.gym_id
    INTO v_email, v_gym_id
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE p.id = p_profile_id
     AND p.gym_id = public.current_gym_id();

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Member not found in your gym';
  END IF;

  -- Generate a 6-digit numeric code
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  -- Expire any existing pending/approved requests for this member
  UPDATE password_reset_requests
     SET status = 'expired'
   WHERE profile_id = p_profile_id
     AND status IN ('pending', 'approved');

  -- Create an admin-initiated, pre-approved request
  INSERT INTO password_reset_requests (
    email, profile_id, gym_id, status, approved_by, email_code, expires_at
  ) VALUES (
    v_email,
    p_profile_id,
    v_gym_id,
    'approved',
    auth.uid(),
    v_code,
    now() + INTERVAL '30 minutes'
  );

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_generate_password_reset(UUID) TO authenticated;
