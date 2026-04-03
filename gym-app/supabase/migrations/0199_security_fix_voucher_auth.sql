-- Security fix: admin_get_or_create_voucher was SECURITY DEFINER with no
-- authorization checks and no search_path restriction.  Any authenticated user
-- could call it to mint reward vouchers for arbitrary gyms/members.
--
-- Fixes applied:
--   1. SET search_path = public to prevent search-path hijacking.
--   2. Authorization check: caller must be admin/super_admin of the target gym.
--   3. Use auth.uid() instead of the caller-supplied p_admin_id so an admin
--      cannot impersonate another admin.  The parameter is kept in the
--      signature for backward compatibility but is ignored.

CREATE OR REPLACE FUNCTION admin_get_or_create_voucher(
  p_gym_id UUID,
  p_member_id UUID,
  p_admin_id UUID,
  p_reward_type TEXT,
  p_reward_label TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing email_reward_vouchers;
  v_new_code TEXT;
  v_result email_reward_vouchers;
BEGIN
  -- Verify caller is admin of the target gym
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_lookup
    WHERE id = auth.uid() AND gym_id = p_gym_id AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Only gym admins can create vouchers';
  END IF;

  -- Check for existing active voucher
  SELECT * INTO v_existing
  FROM email_reward_vouchers
  WHERE gym_id = p_gym_id
    AND member_id = p_member_id
    AND reward_type = p_reward_type
    AND status = 'active';

  IF FOUND THEN
    RETURN row_to_json(v_existing);
  END IF;

  -- Generate random 12-char alphanumeric code
  v_new_code := '';
  FOR i IN 1..12 LOOP
    v_new_code := v_new_code || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36 + 1)::int, 1);
  END LOOP;

  -- Use auth.uid() as admin_id regardless of what was passed in p_admin_id
  INSERT INTO email_reward_vouchers (gym_id, member_id, admin_id, reward_type, reward_label, qr_code)
  VALUES (p_gym_id, p_member_id, auth.uid(), p_reward_type, p_reward_label, v_new_code)
  RETURNING * INTO v_result;

  RETURN row_to_json(v_result);
END;
$$;
