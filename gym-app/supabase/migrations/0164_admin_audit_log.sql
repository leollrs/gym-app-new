-- Admin audit log for tracking admin actions within a single gym
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_gym_created ON admin_audit_log(gym_id, created_at DESC);
CREATE INDEX idx_audit_actor ON admin_audit_log(actor_id);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select_gym_admin" ON admin_audit_log FOR SELECT
  USING (gym_id IN (SELECT gym_id FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));
CREATE POLICY "audit_insert_auth" ON admin_audit_log FOR INSERT
  WITH CHECK (actor_id = auth.uid());

-- Helper RPC for easy audit logging from frontend
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT '{}'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  my_gym UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;
  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;
  INSERT INTO admin_audit_log (gym_id, actor_id, action, entity_type, entity_id, details)
  VALUES (my_gym, uid, p_action, p_entity_type, p_entity_id, p_details);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_admin_action(TEXT, TEXT, UUID, JSONB) TO authenticated;
