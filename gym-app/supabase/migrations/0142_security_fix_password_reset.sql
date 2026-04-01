-- Security hardening for password reset system
-- Fixes HIGH issues: overly permissive anon SELECT, token leaked in RPC response,
-- missing search_path on SECURITY DEFINER functions

-- 1. Replace the overly permissive anon SELECT policy with a token-scoped one
DROP POLICY IF EXISTS "anon_read_own_reset_request" ON password_reset_requests;
CREATE POLICY "anon_read_own_request_by_token" ON password_reset_requests
  FOR SELECT TO anon USING (token = current_setting('request.header.x-reset-token', true));

-- 2. Recreate create_password_reset_request WITHOUT returning the token
CREATE OR REPLACE FUNCTION public.create_password_reset_request(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_token TEXT;
  v_id UUID;
BEGIN
  -- Find profile by email (case-insensitive)
  SELECT p.id, p.gym_id, p.full_name
    INTO v_profile
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE lower(u.email) = lower(p_email)
   LIMIT 1;

  IF NOT FOUND THEN
    -- Don't reveal whether email exists
    RETURN jsonb_build_object('success', true, 'message', 'If an account exists, a reset request has been created');
  END IF;

  -- Invalidate any existing pending requests for this user
  UPDATE password_reset_requests
     SET status = 'expired'
   WHERE profile_id = v_profile.id
     AND status = 'pending';

  -- Create new request
  INSERT INTO password_reset_requests (email, profile_id, gym_id)
  VALUES (lower(p_email), v_profile.id, v_profile.gym_id)
  RETURNING id, token INTO v_id, v_token;

  RETURN jsonb_build_object('success', true, 'request_id', v_id);
END;
$$;

-- 3. Add SET search_path = public to admin_approve_password_reset
CREATE OR REPLACE FUNCTION public.admin_approve_password_reset(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  SELECT * INTO v_request
    FROM password_reset_requests
   WHERE id = p_request_id
     AND gym_id = public.current_gym_id()
     AND status = 'pending'
     AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found or expired');
  END IF;

  UPDATE password_reset_requests
     SET status = 'approved',
         approved_by = auth.uid()
   WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 4. Add SET search_path = public to admin_deny_password_reset
CREATE OR REPLACE FUNCTION public.admin_deny_password_reset(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  UPDATE password_reset_requests
     SET status = 'denied'
   WHERE id = p_request_id
     AND gym_id = public.current_gym_id()
     AND status = 'pending';

  RETURN jsonb_build_object('success', true);
END;
$$;
