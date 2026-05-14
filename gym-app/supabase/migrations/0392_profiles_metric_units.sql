-- ============================================================
-- 0392 — Add profiles.metric_units + expose it through get_auth_context
-- ============================================================
-- The app reads `profiles.metric_units` app-wide — the PersonalInfo units
-- toggle, ActiveSession's weight unit, and the cardio logging screens all
-- branch on it. But the column was never actually created: the PersonalInfo
-- "Save changes" write included `metric_units` in the profiles UPDATE, the
-- whole UPDATE errored ("column does not exist"), and because handleSave
-- never checked `.error` it still showed a green "Saved" toast. Net effect:
-- name / DOB / units never persisted.
--
-- Add the column with DEFAULT FALSE (= imperial), matching the client-side
-- fallback used everywhere else (ActiveSession / CardioLogModal /
-- LiveCardio / CardioSessionDetail all treat undefined as imperial), and
-- surface it through get_auth_context so the saved value is readable on the
-- next login. Body is otherwise identical to 0387.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS metric_units BOOLEAN NOT NULL DEFAULT FALSE;

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
