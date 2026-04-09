-- ============================================================
-- 0303: Fix last_active_at tracking for all roles
--
-- Problem: last_active_at was only updated inside complete_workout()
-- which only members call. Admins and trainers never had their
-- last_active_at updated, so their activity was invisible in any
-- "last active" display across the platform.
--
-- Fix: Replace get_auth_context() STABLE → VOLATILE and update
-- last_active_at on every call (login + session refresh).
-- Throttled to once per hour to avoid excessive writes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_auth_context()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid      UUID := auth.uid();
  _result   JSON;
  _last_active TIMESTAMPTZ;
BEGIN
  -- Update last_active_at for all roles (member, admin, trainer, super_admin).
  -- Throttle to once per hour to avoid excessive writes on token refreshes.
  SELECT last_active_at INTO _last_active
    FROM profiles
   WHERE id = _uid;

  IF _last_active IS NULL OR _last_active < NOW() - INTERVAL '1 hour' THEN
    UPDATE profiles
       SET last_active_at = NOW()
     WHERE id = _uid;
  END IF;

  SELECT json_build_object(
    -- Profile row (re-select after potential update so caller sees fresh value)
    'profile', (
      SELECT row_to_json(p)
        FROM (
          SELECT id, gym_id, full_name, username, role, is_onboarded,
                 avatar_url, avatar_type, avatar_value,
                 preferred_language, membership_status,
                 last_active_at, qr_code_payload,
                 preferred_training_days, skip_suggestion_date,
                 accent_color, trainer_icon,
                 phone_number, bio, specialties, years_of_experience
            FROM profiles
           WHERE id = _uid
        ) p
    ),

    -- Gym branding
    'branding', (
      SELECT row_to_json(b)
        FROM (
          SELECT gb.primary_color, gb.accent_color, gb.palette_name,
                 gb.logo_url, gb.custom_app_name, gb.surface_color
            FROM gym_branding gb
           INNER JOIN profiles pr ON pr.id = _uid AND pr.gym_id = gb.gym_id
        ) b
    ),

    -- Gym basic info
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

    -- Unread notification count
    'unread_count', (
      SELECT COUNT(*)::int
        FROM notifications
       WHERE profile_id = _uid
         AND read_at IS NULL
    ),

    -- Lifetime points for level calculation
    'lifetime_points', (
      SELECT COALESCE(rp.lifetime_points, 0)
        FROM reward_points rp
       WHERE rp.profile_id = _uid
    )
  ) INTO _result;

  RETURN _result;
END;
$$;

-- Grant execute to authenticated users (preserved from previous migration)
GRANT EXECUTE ON FUNCTION public.get_auth_context() TO authenticated;
