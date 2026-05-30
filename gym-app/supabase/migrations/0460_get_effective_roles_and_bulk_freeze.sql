-- =============================================================
-- Missing RPCs surfaced by the security audit:
--   * get_effective_roles  — called by AuthContext.switchView to
--                            re-verify the caller's role bag before
--                            flipping the active view. Was never
--                            defined; only appeared in the revoke
--                            allowlist (0363:84). Errored on call →
--                            silent denial of multi-role view switch.
--   * admin_bulk_freeze    — called by AdminMembers handleBulkFreeze
--                            to centralise freeze + audit. Was never
--                            defined; the UI fell back to direct
--                            UPDATE which skipped audit + membership
--                            history tracking.
-- =============================================================

-- ── get_effective_roles ────────────────────────────────────────
-- Returns the calling user's full role bag (primary + additional)
-- as a text[]. STABLE so PostgREST/RLS can cache. SECURITY DEFINER
-- so the read isn't blocked by profiles_select for the caller's
-- own row (it isn't, but defensive).
CREATE OR REPLACE FUNCTION public.get_effective_roles()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT DISTINCT r::text
      FROM (
        SELECT role::text AS r FROM profiles WHERE id = auth.uid()
        UNION ALL
        SELECT unnest(additional_roles)::text AS r FROM profiles WHERE id = auth.uid()
      ) s
      WHERE r IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_roles() TO authenticated;

COMMENT ON FUNCTION public.get_effective_roles() IS
  'Server-trusted role bag for the calling user. Used by
   AuthContext.switchView to re-verify the requested view before
   trusting client-side availableRoles (which may be stale).';

-- ── admin_bulk_freeze ──────────────────────────────────────────
-- Freezes membership_status for a set of member IDs, all in the
-- caller-admin's gym. Atomic — fails the whole batch on any cross-
-- gym attempt. Writes one admin_audit_log row per member so the
-- bulk operation stays attributable. Also relies on the existing
-- membership_status update trigger (mig 0405) to record per-row
-- history transitions.
--
-- Auth: caller must be admin or super_admin (primary OR additional)
-- in the same gym as every target. Multi-role aware.
CREATE OR REPLACE FUNCTION public.admin_bulk_freeze(p_ids uuid[])
RETURNS TABLE(frozen_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid          uuid := auth.uid();
  _caller_gym   uuid;
  _caller_role  user_role;
  _caller_extra user_role[];
  _is_admin     boolean;
  _bad_count    integer;
  _affected     integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    frozen_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT gym_id, role, additional_roles
    INTO _caller_gym, _caller_role, _caller_extra
    FROM profiles
    WHERE id = _uid;

  _is_admin := _caller_role IN ('admin', 'super_admin')
            OR 'admin'::user_role = ANY(_caller_extra)
            OR 'super_admin'::user_role = ANY(_caller_extra);

  IF NOT _is_admin THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  IF _caller_gym IS NULL THEN
    RAISE EXCEPTION 'caller has no gym';
  END IF;

  -- Reject the whole batch if ANY target lives outside the caller's gym.
  SELECT COUNT(*) INTO _bad_count
    FROM profiles
    WHERE id = ANY(p_ids)
      AND gym_id IS DISTINCT FROM _caller_gym;

  IF _bad_count > 0 THEN
    RAISE EXCEPTION 'cross-gym freeze rejected (% members not in caller gym)', _bad_count;
  END IF;

  UPDATE profiles
     SET membership_status = 'frozen',
         membership_status_updated_at = NOW()
   WHERE id = ANY(p_ids)
     AND gym_id = _caller_gym
     AND membership_status IS DISTINCT FROM 'frozen';

  GET DIAGNOSTICS _affected = ROW_COUNT;

  -- Per-member audit row. Cheaper to inline than loop into log_admin_action.
  INSERT INTO admin_audit_log (gym_id, actor_id, action, entity_type, entity_id, details)
  SELECT _caller_gym, _uid, 'bulk_freeze', 'member', m_id,
         jsonb_build_object('source', 'admin_bulk_freeze', 'batch_size', COALESCE(array_length(p_ids, 1), 0))
    FROM unnest(p_ids) AS m_id;

  frozen_count := _affected;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bulk_freeze(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.admin_bulk_freeze(uuid[]) IS
  'Bulk-freeze member memberships in the caller-admin gym. Atomic on
   cross-gym attempts. Writes one admin_audit_log row per affected
   member. Multi-role aware (consults additional_roles).';
