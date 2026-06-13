-- ============================================================
-- 0528 — get_auth_context: expose the trainer_* profile columns
-- ============================================================
-- Root cause of the "TrainerProfile is empty / saves wipe data" bug:
-- TrainerProfile reads trainer_services / trainer_credentials /
-- trainer_specialties / trainer_availability / trainer_tagline /
-- trainer_cover_url / trainer_default_rate / etc. from the AuthContext
-- profile, but get_auth_context (latest def 0392) never selected them.
-- So the page always rendered empty, and every editor modal seeded
-- from `undefined` — "add a service" rebuilt the JSONB array from []
-- (wiping the rest) and the identity modal nulled 6 columns on save.
--
-- Fix: same body as 0392 + the 13 trainer columns (all added in
-- 0331 / 0390 / 0453). Client-side fix pairs with this migration:
-- AuthContext PATCHABLE_FIELDS + fallback select now include them too.
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
                 pr.metric_units,
                 -- trainer showcase / rate fields (0331, 0390, 0453)
                 pr.trainer_tagline, pr.trainer_cover_url,
                 pr.trainer_years_exp, pr.trainer_location, pr.trainer_pronouns,
                 pr.trainer_specialties, pr.trainer_credentials,
                 pr.trainer_services, pr.trainer_availability,
                 pr.trainer_verified, pr.trainer_directory_visible,
                 pr.trainer_default_rate, pr.trainer_rate_unit,
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
