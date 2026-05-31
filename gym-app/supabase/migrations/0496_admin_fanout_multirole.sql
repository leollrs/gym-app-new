-- ============================================================
-- 0496 — Make _fan_out_admin_notification multi-role aware
-- ============================================================
-- BUG: the 0412 admin notification producers (NPS detractor, moderation
-- flag, password-reset request, churn-critical crossing) all fan out via
-- public._fan_out_admin_notification(), which selects recipients with:
--
--     WHERE gym_id = p_gym_id AND role IN ('admin', 'super_admin')
--
-- That ignores `additional_roles`. After the multi-role work (0332/0465 +
-- the 0493–0495 staff refactor), an admin can hold 'admin' in
-- additional_roles while their PRIMARY `role` is something else (e.g. a
-- trainer who is also a gym admin, or any account promoted via
-- additional_roles). Those admins were silently skipped — the producer
-- inserted ZERO rows for them, so /admin/notifications stayed empty and no
-- admin-side notification ever appeared. This is the exact bug class that
-- migration 0465 fixed for is_admin() and that 0463 already fixed for the
-- sibling helper _notify_gym_admins() — but _fan_out_admin_notification was
-- never updated to match.
--
-- FIX: recreate the function with the same multi-role-aware recipient lookup
-- used by _notify_gym_admins (0463). IN-APP ONLY behavior is preserved by
-- design — these four producer types were intentionally in-app-only (see the
-- 0412 header); 0445 is the push-enabled tier for newer admin types. The ONLY
-- change here is the WHERE clause. Signature, audience, dedup, and the
-- EXCEPTION-safety of every caller are unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public._fan_out_admin_notification(
  p_gym_id     UUID,
  p_type       notification_type,
  p_title      TEXT,
  p_body       TEXT,
  p_data       JSONB,
  p_dedup_root TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  IF p_gym_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_admin IN
    SELECT id
    FROM profiles
    WHERE gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  LOOP
    INSERT INTO notifications (
      profile_id, gym_id, type, title, body, data, dedup_key, audience
    )
    VALUES (
      v_admin.id,
      p_gym_id,
      p_type,
      p_title,
      p_body,
      p_data,
      p_dedup_root || '_' || v_admin.id::text,
      'admin'::user_role
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL
    DO NOTHING;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._fan_out_admin_notification(
  UUID, notification_type, TEXT, TEXT, JSONB, TEXT
) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
