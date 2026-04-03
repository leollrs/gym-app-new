-- =============================================================
-- SECURITY FIX: Admin RPC & RLS enforcement
-- Migration: 0227_security_fix_admin_rpc_enforcement.sql
--
-- Audit found 4 gaps where admin-only resources lacked
-- server-side role enforcement:
--
-- 1. get_admin_notification_prefs() RPC — SECURITY DEFINER with
--    no admin role check. Any authenticated user could call it
--    and have admin notification preference rows seeded.
--
-- 2. admin_kpi_targets RLS — FOR ALL policy only checked gym_id
--    match, not admin role. Any gym member could CRUD targets.
--
-- 3. admin_digest_config RLS — FOR ALL policy only checked
--    profile_id = auth.uid(). No admin role check.
--
-- 4. admin_notification_prefs RLS — SELECT/INSERT/UPDATE
--    policies only checked profile_id = auth.uid(). No admin
--    role check. Also missing DELETE policy.
--
-- All 17 admin-facing RPC functions were audited. The other 16
-- already enforce admin/super_admin checks:
--   - broadcast_notification       (is_admin)
--   - record_gym_purchase          (admin via profile_lookup)
--   - compute_churn_scores         (admin via profiles)
--   - get_nps_stats                (admin via profiles)
--   - admin_create_invite_code     (is_admin)
--   - admin_get_member_email       (is_admin)
--   - admin_generate_password_reset(is_admin)
--   - admin_approve_password_reset (is_admin)
--   - admin_deny_password_reset    (is_admin)
--   - award_challenge_prizes       (admin via profiles)
--   - get_leaderboard_* (5 RPCs)   (gym boundary, not admin-only)
--   - get_or_create_conversation   (same-gym, not admin-only)
-- =============================================================

-- ═══════════════════════════════════════════════════════════════
-- Fix 1: get_admin_notification_prefs() — add admin role check
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_admin_notification_prefs()
RETURNS SETOF admin_notification_prefs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  my_gym UUID;
  v_count INTEGER;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;

  -- Enforce admin role
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  SELECT COUNT(*) INTO v_count FROM admin_notification_prefs WHERE profile_id = uid;

  IF v_count = 0 THEN
    INSERT INTO admin_notification_prefs (profile_id, gym_id, event_type, enabled) VALUES
      (uid, my_gym, 'new_member', true),
      (uid, my_gym, 'member_churned', true),
      (uid, my_gym, 'churn_score_spike', true),
      (uid, my_gym, 'challenge_completed', true),
      (uid, my_gym, 'milestone_reached', false),
      (uid, my_gym, 'password_reset_request', true),
      (uid, my_gym, 'content_report', true),
      (uid, my_gym, 'class_full', false),
      (uid, my_gym, 'low_attendance', true),
      (uid, my_gym, 'new_referral', false),
      (uid, my_gym, 'store_redemption', false),
      (uid, my_gym, 'trainer_note', false);
  END IF;

  RETURN QUERY SELECT * FROM admin_notification_prefs WHERE profile_id = uid ORDER BY event_type;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_notification_prefs() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- Fix 2: admin_kpi_targets — add admin role check to RLS policy
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins can manage KPI targets for their gym" ON admin_kpi_targets;

CREATE POLICY "Admins can manage KPI targets for their gym"
  ON admin_kpi_targets FOR ALL
  USING (
    gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    gym_id = (SELECT gym_id FROM public.profile_lookup WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- Fix 3: admin_digest_config — add admin role check to RLS policy
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Admins can manage their own digest config" ON admin_digest_config;

CREATE POLICY "Admins can manage their own digest config"
  ON admin_digest_config FOR ALL
  USING (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- Fix 4: admin_notification_prefs — add admin role check to all
--         RLS policies and add missing DELETE policy
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "prefs_select_own" ON admin_notification_prefs;
DROP POLICY IF EXISTS "prefs_insert_own" ON admin_notification_prefs;
DROP POLICY IF EXISTS "prefs_update_own" ON admin_notification_prefs;
DROP POLICY IF EXISTS "prefs_delete_own" ON admin_notification_prefs;

CREATE POLICY "prefs_select_own" ON admin_notification_prefs
  FOR SELECT USING (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "prefs_insert_own" ON admin_notification_prefs
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "prefs_update_own" ON admin_notification_prefs
  FOR UPDATE USING (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "prefs_delete_own" ON admin_notification_prefs
  FOR DELETE USING (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profile_lookup
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

NOTIFY pgrst, 'reload schema';
