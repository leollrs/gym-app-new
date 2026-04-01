-- ============================================================
-- 0167: Admin Onboarding Wizard
-- Tracks whether a gym admin has completed the initial setup
-- wizard, and which step they are on.
-- ============================================================

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS setup_step INTEGER DEFAULT 0;

-- Update get_auth_context() to include setup_completed in the gym object
-- so AdminLayout can conditionally show the onboarding wizard.
CREATE OR REPLACE FUNCTION public.get_auth_context()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid      UUID := auth.uid();
  _result   JSON;
BEGIN
  SELECT json_build_object(
    -- Profile row
    'profile', (
      SELECT row_to_json(p)
        FROM (
          SELECT id, gym_id, full_name, username, role, is_onboarded,
                 avatar_url, avatar_type, avatar_value,
                 preferred_language, membership_status,
                 last_active_at, qr_code_payload,
                 preferred_training_days, skip_suggestion_date
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

    -- Gym basic info (now includes setup_completed)
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
