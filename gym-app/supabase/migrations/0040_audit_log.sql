-- ============================================================
-- 0040 — Audit Log for Platform Super Admin
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      uuid REFERENCES gyms(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_gym      ON audit_log (gym_id);
CREATE INDEX idx_audit_log_actor    ON audit_log (actor_id);
CREATE INDEX idx_audit_log_action   ON audit_log (action);
CREATE INDEX idx_audit_log_created  ON audit_log (created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Only super_admin can read the full audit log
CREATE POLICY "super_admin can read all audit_log"
  ON audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Gym admins can read audit entries scoped to their gym
CREATE POLICY "gym admin can read own gym audit_log"
  ON audit_log FOR SELECT
  USING (
    gym_id = current_setting('app.current_gym_id', true)::uuid
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
        AND profiles.gym_id = audit_log.gym_id
    )
  );

-- Insert allowed for authenticated users (typically via application code)
CREATE POLICY "authenticated can insert audit_log"
  ON audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- Super-admin RLS policies for cross-gym access
-- ============================================================

-- Allow super_admin to read ALL gyms (including inactive)
DROP POLICY IF EXISTS "anyone can read active gyms" ON gyms;
CREATE POLICY "anyone can read active gyms"
  ON gyms FOR SELECT
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Allow super_admin to update any gym
CREATE POLICY "super_admin can update any gym"
  ON gyms FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Allow super_admin to insert gyms
CREATE POLICY "super_admin can insert gyms"
  ON gyms FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Allow super_admin to read ALL profiles across gyms
CREATE POLICY "super_admin can read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- Allow super_admin to update any profile (role changes, status changes)
CREATE POLICY "super_admin can update any profile"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- Allow super_admin to read all workout_sessions
CREATE POLICY "super_admin can read all sessions"
  ON workout_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Allow super_admin to read all check_ins
CREATE POLICY "super_admin can read all check_ins"
  ON check_ins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Allow super_admin to read all churn_risk_scores
CREATE POLICY "super_admin can read all churn_scores"
  ON churn_risk_scores FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Allow super_admin to manage global exercises (gym_id IS NULL)
CREATE POLICY "super_admin can insert global exercises"
  ON exercises FOR INSERT
  WITH CHECK (
    gym_id IS NULL
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

CREATE POLICY "super_admin can delete global exercises"
  ON exercises FOR DELETE
  USING (
    gym_id IS NULL
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Allow super_admin to read all gym_branding
CREATE POLICY "super_admin can read all gym_branding"
  ON gym_branding FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

-- Allow super_admin to read all gym_invites
CREATE POLICY "super_admin can read all gym_invites"
  ON gym_invites FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );
