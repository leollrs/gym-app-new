-- ============================================================
-- 0464 — Admin page bug-fix sweep
-- ============================================================
--  1. admin_update_member_email wrote to `profiles.email`, a column
--     that does NOT exist (verified: no migration adds an `email`
--     column to profiles or any table; the login email lives on
--     auth.users only). The bad UPDATE raised and rolled back the
--     whole call, so editing a member's email ALWAYS failed. We drop
--     that line and widen authz + gym-boundary to honour
--     additional_roles (0332 multi-role model), matching 0463.
--
--  2. admin_delete_challenge / admin_delete_class (origin 0293)
--     gated on `role IN ('admin','super_admin')` only — multi-role
--     admins got "access denied". The 0463 sweep missed these two.
--
--  3. admin_audit_log SELECT policy (origin 0164) had the same
--     single-role gate, so multi-role admins saw an empty audit log.
--
-- Behaviour change: existing single-role admins still pass; multi-
-- role holders now pass too. Nothing is tightened.
-- ============================================================

-- ── 1. admin_update_member_email — stop writing nonexistent profiles.email ──
CREATE OR REPLACE FUNCTION public.admin_update_member_email(
  p_member_id UUID,
  p_new_email TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id       UUID;
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_is_super     BOOLEAN;
  v_is_admin     BOOLEAN;
BEGIN
  SELECT role::text, additional_roles
    INTO v_caller_role, v_caller_extra
    FROM profiles WHERE id = auth.uid();

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_admin := (v_caller_role = 'admin'
                 OR 'admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));

  IF NOT (v_is_admin OR v_is_super) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Gym boundary: a non-super admin can only touch members of their own gym.
  IF NOT v_is_super THEN
    SELECT gym_id INTO v_gym_id FROM profiles WHERE id = p_member_id;
    IF v_gym_id IS NULL OR v_gym_id != current_gym_id() THEN
      RAISE EXCEPTION 'Member not found in your gym';
    END IF;
  END IF;

  IF p_new_email IS NULL OR p_new_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(p_new_email) AND id != p_member_id) THEN
    RAISE EXCEPTION 'Email already in use by another account';
  END IF;

  -- The login email lives on auth.users only; profiles has no email column.
  UPDATE auth.users SET email = lower(p_new_email) WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth user not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_member_email(UUID, TEXT) TO authenticated;

-- ── 2. admin_delete_challenge — honour additional_roles ──
CREATE OR REPLACE FUNCTION public.admin_delete_challenge(p_challenge_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM challenges c
    JOIN profiles p ON p.gym_id = c.gym_id
    WHERE c.id = p_challenge_id
      AND p.id = auth.uid()
      AND (p.role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(p.additional_roles)
           OR 'super_admin'::user_role = ANY(p.additional_roles))
  ) THEN
    RAISE EXCEPTION 'Challenge not found or access denied';
  END IF;

  DELETE FROM challenge_participants      WHERE challenge_id = p_challenge_id;
  DELETE FROM daily_challenge_completions WHERE challenge_id = p_challenge_id;

  DELETE FROM challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found or access denied';
  END IF;
END;
$$;

-- ── 2b. admin_delete_class — honour additional_roles ──
CREATE OR REPLACE FUNCTION public.admin_delete_class(p_class_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM gym_classes gc
    JOIN profiles p ON p.gym_id = gc.gym_id
    WHERE gc.id = p_class_id
      AND p.id = auth.uid()
      AND (p.role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(p.additional_roles)
           OR 'super_admin'::user_role = ANY(p.additional_roles))
  ) THEN
    RAISE EXCEPTION 'Class not found or access denied';
  END IF;

  DELETE FROM gym_class_schedules WHERE class_id = p_class_id;
  DELETE FROM gym_class_bookings  WHERE class_id = p_class_id;

  DELETE FROM gym_classes WHERE id = p_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class not found or access denied';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_class(UUID)     TO authenticated;

-- ── 3. admin_audit_log SELECT policy — honour additional_roles ──
DROP POLICY IF EXISTS "audit_select_gym_admin" ON admin_audit_log;
CREATE POLICY "audit_select_gym_admin" ON admin_audit_log FOR SELECT
  USING (gym_id IN (
    SELECT gym_id FROM profiles
    WHERE id = auth.uid()
      AND (role IN ('admin', 'super_admin')
           OR 'admin'::user_role       = ANY(additional_roles)
           OR 'super_admin'::user_role = ANY(additional_roles))
  ));

NOTIFY pgrst, 'reload schema';
