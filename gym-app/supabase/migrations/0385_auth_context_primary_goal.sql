-- ============================================================
-- 0385 — Add primary_goal + fitness_level + sex + health_sync_enabled
--         to get_auth_context
-- ============================================================
-- Bug: ExerciseLibrary detail card shows a goal-adjusted badge
-- ("Hipertrofia", "Fuerza", etc.) derived from profile.primary_goal.
-- get_auth_context (last edited in 0349) never selected primary_goal,
-- so AuthContext.profile.primary_goal was always undefined and the
-- badge fell back to "Forma General" for every user.
--
-- Fix: re-issue get_auth_context with primary_goal, fitness_level,
-- sex, and health_sync_enabled added to the profile sub-select.
-- Body otherwise identical to 0349.
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
          SELECT id, gym_id, full_name, username,
                 role, additional_roles,
                 is_onboarded,
                 avatar_url, avatar_type, avatar_value,
                 preferred_language, membership_status,
                 last_active_at, qr_code_payload,
                 preferred_training_days, skip_suggestion_date,
                 accent_color, trainer_icon,
                 phone_number, bio, specialties, years_of_experience,
                 date_of_birth, age_verified_at,
                 primary_goal, fitness_level, sex, health_sync_enabled
            FROM profiles
           WHERE id = _uid
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
