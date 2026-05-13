-- ============================================================
-- 0387 — Expose primary_goal / fitness_level / sex / health_sync_enabled
--         through get_auth_context (correct table this time)
-- ============================================================
-- 0385 tried to add these to the profile sub-select but three of the
-- four live on `member_onboarding`, not `profiles` — the RPC errored
-- with "column does not exist" and logins broke. 0386 reverted to the
-- 0349 body.
--
-- Correct mapping (verified against migrations):
--   profiles.health_sync_enabled        (0121)
--   member_onboarding.primary_goal      (0001)
--   member_onboarding.fitness_level     (0001)
--   member_onboarding.sex               (0048)
--
-- Strategy: keep `health_sync_enabled` in the profile sub-select; LEFT
-- JOIN `member_onboarding` to pull the three onboarding-driven fields
-- alongside it. LEFT JOIN so brand-new users with no onboarding row
-- still return a profile (the three fields come back NULL — same as
-- before, the client falls back to 'general_fitness').
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_auth_context()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    UUID := auth.uid();
  _result JSON;
BEGIN
  SELECT json_build_object(
    'profile', (
      SELECT row_to_json(p)
        FROM (
          SELECT pr.id, pr.gym_id, pr.full_name, pr.username,
                 pr.role, pr.additional_roles,
                 pr.is_onboarded,
                 pr.avatar_url, pr.avatar_type, pr.avatar_value,
                 pr.preferred_language, pr.membership_status,
                 pr.last_active_at, pr.qr_code_payload,
                 pr.preferred_training_days, pr.skip_suggestion_date,
                 pr.accent_color, pr.trainer_icon,
                 pr.phone_number, pr.bio, pr.specialties, pr.years_of_experience,
                 pr.date_of_birth, pr.age_verified_at,
                 pr.health_sync_enabled,
                 mo.primary_goal::text  AS primary_goal,
                 mo.fitness_level::text AS fitness_level,
                 mo.sex                 AS sex
            FROM profiles pr
            LEFT JOIN member_onboarding mo ON mo.profile_id = pr.id
           WHERE pr.id = _uid
        ) p
    ),
    'branding', (
      SELECT row_to_json(b)
        FROM (
          SELECT gb.primary_color, gb.accent_color, gb.palette_name,
                 gb.logo_url, gb.custom_app_name, gb.surface_color
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

NOTIFY pgrst, 'reload schema';
