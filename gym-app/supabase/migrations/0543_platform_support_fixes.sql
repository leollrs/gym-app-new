-- ============================================================
-- 0543: Platform support-console fixes (audit P2-1/2/10/11 + ErrorLogs P3)
--
-- 1. admin_generate_password_reset — super_admin can reset cross-gym
--    (0174 required p.gym_id = current_gym_id(), so the platform
--    Support console could only reset the founder's own gym; the
--    "Member not found in your gym" error actively misled).
-- 2. admin_lookup_by_email — super_admin email → profile lookup
--    (profiles has no email column; email lives in auth.users).
-- 3. member_invites — super_admin SELECT arm (0149 dropped the open
--    SELECT; the remaining "Admins can manage invites" policy is
--    gym-scoped, so the platform omnibox could never match codes).
--    NOTE: admin_create_invite_code (0305) needs NO change — it is
--    is_admin()-gated (which includes super_admin per 0465) and takes
--    p_gym_id with no own-gym check, so it already works cross-gym.
-- 4. log_admin_action — new trailing p_target_gym_id so platform
--    support actions file under the AFFECTED gym, not the actor's
--    (0299 stamped the actor's gym; with a NULL-gym founder profile
--    the NOT NULL admin_audit_log.gym_id made every call throw).
-- 5. error_logs — acknowledge/resolve workflow (acknowledged_at/by +
--    super_admin UPDATE policy) + partial index for the default
--    "unresolved" view.
-- 6. platform_audit_actor_count — exact distinct-actor count for the
--    AuditLog summary tile (replaces an unranged 1000-row select).
--
-- Idempotent. Apply manually.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. admin_generate_password_reset: same-gym admin OR super_admin
--    Signature/return shape/grants preserved from 0174.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_generate_password_reset(p_profile_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_gym_id UUID;
  v_code TEXT;
BEGIN
  -- Only admins can call this
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  -- Look up the member's email and gym (no gym filter here so we can
  -- give an honest error instead of "not found" for cross-gym targets)
  SELECT u.email, p.gym_id
    INTO v_email, v_gym_id
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE p.id = p_profile_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Gym admins may only reset members of their own gym;
  -- super_admins may reset any member on the platform.
  IF NOT public.is_super_admin()
     AND (v_gym_id IS NULL OR v_gym_id IS DISTINCT FROM public.current_gym_id()) THEN
    RAISE EXCEPTION 'Member belongs to a different gym';
  END IF;

  -- Generate a 6-digit numeric code
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  -- Expire any existing pending/approved requests for this member
  UPDATE password_reset_requests
     SET status = 'expired'
   WHERE profile_id = p_profile_id
     AND status IN ('pending', 'approved');

  -- Create an admin-initiated, pre-approved request
  INSERT INTO password_reset_requests (
    email, profile_id, gym_id, status, approved_by, email_code, expires_at
  ) VALUES (
    v_email,
    p_profile_id,
    v_gym_id,
    'approved',
    auth.uid(),
    v_code,
    now() + INTERVAL '30 minutes'
  );

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_generate_password_reset(UUID) TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 2. admin_lookup_by_email: super_admin-only email search
--    (auth.users.email ilike, joined to profiles + gyms)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_lookup_by_email(p_email TEXT)
RETURNS TABLE (
  profile_id        UUID,
  full_name         TEXT,
  gym_id            UUID,
  gym_name          TEXT,
  role              TEXT,
  membership_status TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) < 3 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id,
         p.full_name,
         p.gym_id,
         g.name,
         p.role::text,
         p.membership_status::text
    FROM auth.users u
    JOIN profiles p ON p.id = u.id
    LEFT JOIN gyms g ON g.id = p.gym_id
   WHERE u.email ILIKE '%' || trim(p_email) || '%'
   ORDER BY u.email
   LIMIT 10;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_lookup_by_email(TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────
-- 3. member_invites: super_admin SELECT arm
--    (verified: 0118's "Admins can manage invites" is gym-scoped and
--    0149 dropped the blanket authenticated SELECT)
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'member_invites'
      AND policyname = 'member_invites_select_super_admin'
  ) THEN
    CREATE POLICY member_invites_select_super_admin ON public.member_invites
      FOR SELECT USING (public.is_super_admin());
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 4. log_admin_action: + p_target_gym_id (audit attribution)
--    effective gym = COALESCE(p_target_gym_id, actor's gym_id).
--    When both are NULL (platform founder with no gym): skip
--    admin_audit_log (gym_id NOT NULL there, 0164) but still write
--    audit_log (gym_id nullable, 0040). Never raises.
--    Old 4-param signature dropped to avoid overload ambiguity —
--    the new one defaults p_target_gym_id so existing callers are
--    unaffected.
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.log_admin_action(TEXT, TEXT, UUID, JSONB);

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
  IF uid IS NULL THEN RETURN; END IF;
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


-- ────────────────────────────────────────────────────────────
-- 5. error_logs: acknowledge/resolve workflow
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Default platform view is "unresolved" — keep it fast.
CREATE INDEX IF NOT EXISTS idx_error_logs_unacked
  ON public.error_logs (created_at DESC)
  WHERE acknowledged_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'error_logs'
      AND policyname = 'super_admin_update_errors'
  ) THEN
    CREATE POLICY super_admin_update_errors ON public.error_logs
      FOR UPDATE
      USING (public.is_super_admin())
      WITH CHECK (public.is_super_admin());
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 6. platform_audit_actor_count: exact distinct actor count for the
--    AuditLog "Active Actors" tile (mirrors the page's filters;
--    p_action_prefix supports the tv_* / print_* / super_admin_*
--    grouped filters).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_audit_actor_count(
  p_start         TIMESTAMPTZ DEFAULT NULL,
  p_end           TIMESTAMPTZ DEFAULT NULL,
  p_action        TEXT DEFAULT NULL,
  p_action_prefix TEXT DEFAULT NULL,
  p_gym_id        UUID DEFAULT NULL,
  p_search        TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT COUNT(DISTINCT a.actor_id)::int
    INTO v_count
    FROM audit_log a
   WHERE a.actor_id IS NOT NULL
     AND (p_start IS NULL OR a.created_at >= p_start)
     AND (p_end IS NULL OR a.created_at <= p_end)
     AND (p_action IS NULL OR a.action = p_action)
     AND (p_action_prefix IS NULL OR a.action LIKE p_action_prefix || '%')
     AND (p_gym_id IS NULL OR a.gym_id = p_gym_id)
     AND (p_search IS NULL OR a.action ILIKE '%' || p_search || '%');

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_audit_actor_count(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT) TO authenticated;


NOTIFY pgrst, 'reload schema';
