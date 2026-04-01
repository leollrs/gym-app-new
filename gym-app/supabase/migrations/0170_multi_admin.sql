-- ============================================================
-- 0170: Multi-Admin Support
-- Allows gyms to have multiple admin accounts, controlled by
-- super_admin via platform dashboard.
-- ============================================================

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS multi_admin_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS max_admin_seats INT DEFAULT 1;

-- Track admin presence for multi-admin awareness
CREATE TABLE IF NOT EXISTS admin_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  current_page TEXT,
  UNIQUE(profile_id)
);

CREATE INDEX idx_admin_presence_gym ON admin_presence(gym_id, last_seen_at DESC);

ALTER TABLE admin_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can see presence for their gym"
  ON admin_presence FOR SELECT
  USING (gym_id = (SELECT gym_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can upsert their own presence"
  ON admin_presence FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- RPC to heartbeat presence
CREATE OR REPLACE FUNCTION public.admin_heartbeat(p_page TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _gym_id UUID;
BEGIN
  SELECT gym_id INTO _gym_id FROM profiles WHERE id = _uid AND role IN ('admin', 'super_admin');
  IF _gym_id IS NULL THEN RETURN; END IF;

  INSERT INTO admin_presence (profile_id, gym_id, last_seen_at, current_page)
  VALUES (_uid, _gym_id, now(), p_page)
  ON CONFLICT (profile_id)
  DO UPDATE SET last_seen_at = now(), current_page = COALESCE(p_page, admin_presence.current_page);
END;
$$;

-- Update get_auth_context to include multi_admin_enabled
-- (Add to existing gym select in get_auth_context)
-- This is handled by updating the existing function to include gy.multi_admin_enabled
