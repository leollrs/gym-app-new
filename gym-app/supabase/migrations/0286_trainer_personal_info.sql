-- Add trainer personal info columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS specialties TEXT[];
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS years_of_experience SMALLINT;

COMMENT ON COLUMN profiles.specialties IS 'Trainer specialties/certifications array (e.g. CrossFit L2, Yoga, Sports Nutrition)';
COMMENT ON COLUMN profiles.years_of_experience IS 'Years of professional training experience';

-- Update get_auth_context() to include trainer personal info fields
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
