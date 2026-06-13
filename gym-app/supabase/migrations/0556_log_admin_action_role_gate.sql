-- =============================================================
-- 0556_log_admin_action_role_gate.sql
--
-- log_admin_action (0543) only required auth.uid() IS NOT NULL, so ANY
-- authenticated member could call it from the console and write arbitrary
-- rows into admin_audit_log / audit_log scoped to their own gym. Blast
-- radius is limited (actor_id is forced to auth.uid() — no impersonation —
-- and members cannot READ the audit log), but it lets a member spoof audit
-- entries an admin would later trust. Gate on public.is_admin() (multi-role
-- aware incl. super_admin per 0465) — the only legitimate callers are the
-- admin UI and the front-desk scan handlers, all of which run as an admin.
--
-- Verbatim from 0543 except: the `uid IS NULL` guard becomes a role gate.
-- =============================================================

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT '{}',
  p_target_gym_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  my_gym UUID;
  eff_gym UUID;
BEGIN
  uid := auth.uid();
  -- Role gate: silently no-op for non-admins (was: only `uid IS NULL` check,
  -- which let any authenticated member pollute the audit log).
  IF uid IS NULL OR NOT public.is_admin() THEN RETURN; END IF;
  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  eff_gym := COALESCE(p_target_gym_id, my_gym);

  -- Write to admin_audit_log (gym-scoped, read by gym admins).
  -- gym_id is NOT NULL there, so skip when no gym can be attributed.
  IF eff_gym IS NOT NULL THEN
    BEGIN
      INSERT INTO admin_audit_log (gym_id, actor_id, action, entity_type, entity_id, details)
      VALUES (eff_gym, uid, p_action, p_entity_type, p_entity_id, p_details);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- audit logging must never break the calling action
    END;
  END IF;

  -- Also write to audit_log (platform-scoped, read by super admins).
  -- gym_id is nullable here (0040), so platform-level actions with no
  -- attributable gym are still recorded.
  BEGIN
    INSERT INTO audit_log (gym_id, actor_id, action, target_type, target_id, metadata)
    VALUES (eff_gym, uid, p_action, p_entity_type, p_entity_id, p_details);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_admin_action(TEXT, TEXT, UUID, JSONB, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
