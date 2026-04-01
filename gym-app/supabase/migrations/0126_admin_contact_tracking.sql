-- Admin contact tracking: moves contact status from localStorage to DB
-- and supports attribution tracking per contact method

CREATE TABLE IF NOT EXISTS admin_contact_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  member_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id     UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  method     TEXT,          -- 'in_app_message', 'email', 'push', 'sms', 'win_back', 'manual'
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_contact_log_member ON admin_contact_log(member_id);
CREATE INDEX idx_admin_contact_log_gym    ON admin_contact_log(gym_id);

-- RLS: admins can manage their own gym's contact logs
ALTER TABLE admin_contact_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view own gym contact logs"
  ON admin_contact_log FOR SELECT
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can insert own gym contact logs"
  ON admin_contact_log FOR INSERT
  WITH CHECK (
    admin_id = auth.uid()
    AND gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can delete own gym contact logs"
  ON admin_contact_log FOR DELETE
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );
