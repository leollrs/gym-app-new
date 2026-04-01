-- QR-based admin-assisted password reset
-- Flow: user enters email → QR appears → admin scans → approves → user sets new password

-- Drop old table if exists from previous version
DROP TABLE IF EXISTS password_reset_codes;

CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'used', 'expired')),
  approved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),
  used_at TIMESTAMPTZ,
  email_code TEXT
);

CREATE INDEX idx_reset_requests_email_code ON password_reset_requests(email_code);

CREATE INDEX idx_reset_requests_token ON password_reset_requests(token);
CREATE INDEX idx_reset_requests_status ON password_reset_requests(status, expires_at);

ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;

-- Enable realtime for this table so user screen updates when admin approves
ALTER PUBLICATION supabase_realtime ADD TABLE password_reset_requests;

-- Anyone can insert a request (user is not authenticated - they forgot their password)
-- We use anon key for this
CREATE POLICY "anon_insert_reset_request" ON password_reset_requests
  FOR INSERT TO anon
  WITH CHECK (true);

-- Anyone can read their own request by token (for realtime subscription)
CREATE POLICY "anon_read_own_reset_request" ON password_reset_requests
  FOR SELECT TO anon
  USING (true);

-- Authenticated admins can read requests for their gym
CREATE POLICY "admin_read_reset_requests" ON password_reset_requests
  FOR SELECT TO authenticated
  USING (
    gym_id = public.current_gym_id()
    AND EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Authenticated admins can update (approve/deny) requests for their gym
CREATE POLICY "admin_update_reset_requests" ON password_reset_requests
  FOR UPDATE TO authenticated
  USING (
    gym_id = public.current_gym_id()
    AND EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    gym_id = public.current_gym_id()
    AND EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- RPC to create a reset request (called by unauthenticated user)
-- Looks up profile by email, creates the request
CREATE OR REPLACE FUNCTION public.create_password_reset_request(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_id,
    'token', v_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_password_reset_request(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.create_password_reset_request(TEXT) TO authenticated;

-- RPC for admin to approve a reset request
CREATE OR REPLACE FUNCTION public.admin_approve_password_reset(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

GRANT EXECUTE ON FUNCTION public.admin_approve_password_reset(UUID) TO authenticated;

-- RPC for admin to deny a reset request
CREATE OR REPLACE FUNCTION public.admin_deny_password_reset(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

GRANT EXECUTE ON FUNCTION public.admin_deny_password_reset(UUID) TO authenticated;
