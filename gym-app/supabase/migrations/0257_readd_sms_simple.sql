-- =============================================================
-- 0257 — Re-add SMS infrastructure (lean, platform-managed)
--
-- Twilio SMS was removed in 0231. Re-adding as a simpler,
-- platform-level channel for churn win-back escalation.
--
-- Key differences from original:
--   - No per-gym Twilio config (platform env vars)
--   - Hard cap: 200 SMS/month per gym
--   - Channel column on drip_campaign_steps for escalation ladder
--   - Simple audit log (sms_log) instead of conversations
-- =============================================================

-- ── 1. Re-add phone_number to profiles ─────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;


-- ── 2. Add channel to drip_campaign_steps ──────────────────
-- Values: 'notification' (default/existing), 'email', 'sms'

ALTER TABLE drip_campaign_steps
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'notification';


-- ── 3. Monthly SMS usage counter per gym ───────────────────

CREATE TABLE IF NOT EXISTS sms_usage_monthly (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id  UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    month   TEXT NOT NULL,  -- 'YYYY-MM'
    count   INT  NOT NULL DEFAULT 0,
    UNIQUE(gym_id, month)
);

ALTER TABLE sms_usage_monthly ENABLE ROW LEVEL SECURITY;

-- Gym admins can read their own usage
CREATE POLICY "sms_usage_admin_read" ON sms_usage_monthly
  FOR SELECT USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Super admin can read all gyms (platform dashboard)
CREATE POLICY "sms_usage_super_admin_read" ON sms_usage_monthly
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );


-- ── 4. SMS audit log ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS sms_log (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id        UUID        NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    admin_id      UUID        REFERENCES profiles(id),  -- null for automated sends
    phone_number  TEXT        NOT NULL,
    body          TEXT        NOT NULL,
    twilio_sid    TEXT,
    status        TEXT        DEFAULT 'sent',     -- sent, failed, delivered
    source        TEXT        DEFAULT 'manual',   -- manual, automated, win_back
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_log_gym_created
  ON sms_log(gym_id, created_at DESC);

ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;

-- Gym admins can read/insert their own gym's logs
CREATE POLICY "sms_log_admin" ON sms_log
  FOR ALL USING (
    gym_id IN (
      SELECT gym_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Super admin can read all logs (platform dashboard)
CREATE POLICY "sms_log_super_admin_read" ON sms_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );


-- ── 5. Atomic SMS usage increment ──────────────────────────

CREATE OR REPLACE FUNCTION increment_sms_usage(
  p_gym_id UUID,
  p_month  TEXT,
  p_count  INT DEFAULT 1
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INT;
BEGIN
  INSERT INTO sms_usage_monthly (gym_id, month, count)
  VALUES (p_gym_id, p_month, p_count)
  ON CONFLICT (gym_id, month)
    DO UPDATE SET count = sms_usage_monthly.count + p_count
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_sms_usage(UUID, TEXT, INT) TO service_role;


NOTIFY pgrst, 'reload schema';
