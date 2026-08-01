-- 0667_auth_context_active_trainer_plan.sql
-- purpose: return profiles.active_trainer_plan_id (0666) from get_auth_context.
--
-- Without this the column exists and the write succeeds, but the app never
-- learns about it: the session profile comes from this RPC's FIXED column list,
-- so on every boot active_trainer_plan_id is simply absent, `onTrainerPlan`
-- reads false, and the member is silently back on their generated program with
-- their coach's plan still marked adopted in the database.
--
-- Rebuilt VERBATIM from 0528 — the latest CREATE OR REPLACE of this function
-- (0583 only NULLs stored trainer_pronouns values; it does not redefine it).
-- One added column, everything else untouched, including the trainer_pronouns
-- select that 0583 deliberately left in place so login can't break.

-- GUARD. CREATE OR REPLACE on a PL/pgSQL function does NOT resolve column
-- references at creation time — only the syntax is checked, the inner SQL is
-- planned on first call. So applying this before 0666 reports SUCCESS and then
-- raises 42703 on every single session boot: no profile, no branding, no gym.
-- Fail loudly here instead.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND column_name = 'active_trainer_plan_id'
  ) THEN
    RAISE EXCEPTION 'apply 0666_member_active_trainer_plan.sql first — profiles.active_trainer_plan_id does not exist';
  END IF;
END $guard$;

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
                 -- 0666: which coach plan (if any) is standing in for this
                 -- member's own generated program.
                 pr.active_trainer_plan_id,
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
