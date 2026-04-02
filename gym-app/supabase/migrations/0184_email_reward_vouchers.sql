-- Reward vouchers for win-back emails
CREATE TABLE IF NOT EXISTS email_reward_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  reward_type TEXT NOT NULL,   -- 'pt_session', 'discount', 'class_pass', 'bring_partner', 'custom'
  reward_label TEXT NOT NULL,  -- human-readable: "Free PT Session", "Trae un compañero"
  qr_code TEXT NOT NULL UNIQUE,-- random 12-char alphanumeric code for QR
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired')),
  redeemed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup: only one active voucher per member + reward type per gym
CREATE UNIQUE INDEX idx_voucher_dedup
  ON email_reward_vouchers(gym_id, member_id, reward_type)
  WHERE status = 'active';

-- Lookup by QR code (already unique, but explicit index for speed)
CREATE INDEX idx_voucher_qr ON email_reward_vouchers(qr_code);

-- List vouchers per gym
CREATE INDEX idx_voucher_gym ON email_reward_vouchers(gym_id, created_at DESC);

-- List vouchers per member
CREATE INDEX idx_voucher_member ON email_reward_vouchers(member_id, created_at DESC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE email_reward_vouchers ENABLE ROW LEVEL SECURITY;

-- Admins can read vouchers for their own gym
CREATE POLICY "admin_read_vouchers" ON email_reward_vouchers
  FOR SELECT USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Admins can insert vouchers for their own gym
CREATE POLICY "admin_insert_vouchers" ON email_reward_vouchers
  FOR INSERT WITH CHECK (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Admins can update vouchers for their own gym (redeem, expire)
CREATE POLICY "admin_update_vouchers" ON email_reward_vouchers
  FOR UPDATE USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Service role bypass (for edge functions)
CREATE POLICY "service_role_all_vouchers" ON email_reward_vouchers
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- RPC: get or create a voucher (idempotent)
-- ============================================================
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
AS $$
DECLARE
  v_existing email_reward_vouchers;
  v_new_code TEXT;
  v_result email_reward_vouchers;
BEGIN
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

  INSERT INTO email_reward_vouchers (gym_id, member_id, admin_id, reward_type, reward_label, qr_code)
  VALUES (p_gym_id, p_member_id, p_admin_id, p_reward_type, p_reward_label, v_new_code)
  RETURNING * INTO v_result;

  RETURN row_to_json(v_result);
END;
$$;

-- ============================================================
-- RPC: redeem a voucher by QR code (member-locked)
-- ============================================================
CREATE OR REPLACE FUNCTION admin_redeem_voucher(p_qr_code TEXT, p_member_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_voucher email_reward_vouchers;
BEGIN
  -- Admin-only check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT * INTO v_voucher
  FROM email_reward_vouchers
  WHERE qr_code = p_qr_code
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Voucher not found or already redeemed');
  END IF;

  -- Verify the voucher belongs to this specific member
  IF v_voucher.member_id != p_member_id THEN
    RETURN json_build_object('error', 'This reward belongs to a different member');
  END IF;

  -- Verify the voucher belongs to the admin's gym
  IF v_voucher.gym_id != public.current_gym_id() THEN
    RETURN json_build_object('error', 'Voucher not found in your gym');
  END IF;

  -- Check expiry
  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < NOW() THEN
    UPDATE email_reward_vouchers SET status = 'expired' WHERE id = v_voucher.id;
    RETURN json_build_object('error', 'Voucher has expired');
  END IF;

  UPDATE email_reward_vouchers
  SET status = 'redeemed', redeemed_at = NOW()
  WHERE id = v_voucher.id
  RETURNING * INTO v_voucher;

  RETURN row_to_json(v_voucher);
END;
$$;
