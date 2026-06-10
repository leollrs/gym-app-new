-- ============================================================
-- 0524 — get_leaderboard_streaks(): member-visible streak board
-- ============================================================
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor.
--
-- The Streak leaderboard was the ONLY category reading its table directly
-- (useSupabaseQuery.js streak branch on streak_cache). Migration 0354
-- restricted streak_cache SELECT to own-row for members (gym-wide only for
-- admin/trainer), so regular members saw a one-person board — themselves —
-- while admins testing in member view saw the full gym, masking the bug.
--
-- This SECURITY DEFINER RPC mirrors get_leaderboard_checkins (0143) exactly:
-- gym boundary check, leaderboard_visible filter (0493's trigger forces it
-- FALSE for all staff, so staff never appear), optional tier filter, clamped
-- limit, and the same {id, name, avatar, score, tier} row shape the client's
-- normalizeStreak passes through untouched.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_leaderboard_streaks(
  p_gym_id UUID,
  p_tier   TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  -- Gym boundary check (same as every 0143 leaderboard RPC)
  IF p_gym_id != public.current_gym_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: gym boundary violation';
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT
      sc.profile_id AS id,
      p.full_name AS name,
      p.avatar_url AS avatar,
      sc.current_streak_days::int AS score,
      mo.fitness_level AS tier
    FROM streak_cache sc
    JOIN profiles p ON p.id = sc.profile_id
    LEFT JOIN member_onboarding mo ON mo.profile_id = sc.profile_id
    WHERE sc.gym_id = p_gym_id
      AND sc.current_streak_days > 0
      AND p.leaderboard_visible = TRUE
      AND (p_tier IS NULL OR mo.fitness_level = p_tier::fitness_level)
    ORDER BY score DESC, sc.profile_id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard_streaks(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_streaks(UUID, TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
