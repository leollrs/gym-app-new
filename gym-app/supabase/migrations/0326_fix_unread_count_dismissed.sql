-- ============================================================
-- 0326 — Exclude dismissed notifications from unread_count
-- ============================================================
-- get_auth_context returned the unread badge count from
--   WHERE profile_id = _uid AND read_at IS NULL
-- This counted soft-deleted (dismissed) notifications, so the
-- badge stayed lit after the user cleared all notifications
-- (which sets dismissed_at, not read_at). The client-side
-- fetchUnreadNotifications already filters by dismissed_at IS NULL;
-- this aligns the RPC so the badge clears on next app load too.

CREATE OR REPLACE FUNCTION public.get_auth_context()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _result JSON;
BEGIN
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'profile', (
      SELECT row_to_json(p)
        FROM (
          SELECT id, gym_id, full_name, username, role, is_onboarded,
                 avatar_url, avatar_type, avatar_value, preferred_language,
                 membership_status, last_active_at, qr_code_payload,
                 preferred_training_days, skip_suggestion_date, accent_color,
                 trainer_icon, phone_number, bio, specialties,
                 years_of_experience
            FROM profiles
           WHERE id = _uid
        ) p
    ),
    'branding', (
      SELECT row_to_json(b)
        FROM (
          SELECT primary_color, accent_color, custom_app_name, logo_url,
                 palette_name, surface_color
            FROM gym_branding gb
           INNER JOIN profiles pr ON pr.id = _uid AND pr.gym_id = gb.gym_id
        ) b
    ),
    'gym', (
      SELECT row_to_json(g)
        FROM (
          SELECT gy.name, gy.is_active, gy.qr_enabled, gy.qr_display_format,
                 gy.classes_enabled, gy.setup_completed, gy.setup_step,
                 gy.slug
            FROM gyms gy
           INNER JOIN profiles pr ON pr.id = _uid AND pr.gym_id = gy.id
        ) g
    ),
    'unread_count', (
      SELECT COUNT(*)::int
        FROM notifications
       WHERE profile_id = _uid
         AND read_at IS NULL
         AND dismissed_at IS NULL
    ),
    'lifetime_points', (
      SELECT COALESCE(rp.lifetime_points, 0)
        FROM reward_points rp
       WHERE rp.profile_id = _uid
    )
  ) INTO _result;

  RETURN _result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_auth_context() TO authenticated;
