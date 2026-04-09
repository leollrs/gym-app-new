-- S20: Unify audit logging — log_admin_action now writes to BOTH tables
-- The platform AuditLog page reads from audit_log, but log_admin_action
-- only wrote to admin_audit_log. Now it writes to both so platform admins
-- see all actions in a single view.

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

  -- Write to admin_audit_log (gym-scoped, read by gym admins)
  INSERT INTO admin_audit_log (gym_id, actor_id, action, entity_type, entity_id, details)
  VALUES (my_gym, uid, p_action, p_entity_type, p_entity_id, p_details);

  -- Also write to audit_log (platform-scoped, read by super admins)
  INSERT INTO audit_log (gym_id, actor_id, action, target_type, target_id, metadata)
  VALUES (my_gym, uid, p_action, p_entity_type, p_entity_id, p_details);
END;
$$;

NOTIFY pgrst, 'reload schema';
