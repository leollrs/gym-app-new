-- SECURITY: Restore server-side points whitelist removed by migration 0255.
--
-- Migration 0255 added authorization checks but removed the CASE-based whitelist
-- that was introduced in 0220, meaning a member could call:
--
--   add_reward_points(own_user_id, own_gym_id, 'workout_completed', 100000, 'exploit')
--
-- and award themselves up to 100,000 points, because 0255 used the client-sent
-- p_points value directly (only bounding it between -10000 and 100000).
--
-- This migration replaces the function with a version that has BOTH:
--   1. The authorization checks from 0255
--      (caller must be the target user, OR an admin/trainer of the same gym)
--   2. The server-side CASE whitelist from 0220
--      (p_points is completely IGNORED; canonical values are baked in here)
--
-- Points map (must stay in sync with POINTS_MAP in rewardsEngine.js):
--   workout_completed    50
--   pr_hit               20   (client sends 20 per PR; capped at 5/session = 100 max in app)
--   check_in             20   (24-hr rate-limit enforced separately by add_reward_points_checked)
--   streak_day           variable 20–35, capped at 35 server-side
--   challenge_completed  500
--   achievement_unlocked 75
--   weight_logged        10
--   first_weekly_workout 25
--   streak_7             200
--   streak_30            1000
--   daily_challenge      25
--   challenge_joined     25
--
-- Any action_type not in the whitelist raises an exception immediately,
-- so new action types must be explicitly added here before client code can use them.

CREATE OR REPLACE FUNCTION public.add_reward_points(
  p_user_id     UUID,
  p_gym_id      UUID,
  p_action      TEXT,
  p_points      INT,          -- accepted for API compatibility but IGNORED; server derives value
  p_description TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_total    INT;
  new_lifetime INT;
  v_points     INT;
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────────────────
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── 2. Authorization ─────────────────────────────────────────────────────────
  -- Members may only call this for themselves.
  -- Admins, trainers, and super_admins of the same gym may award points to any member.
  IF auth.uid() != p_user_id THEN
    IF NOT EXISTS (
      SELECT 1
      FROM profiles
      WHERE id      = auth.uid()
        AND gym_id  = p_gym_id
        AND role   IN ('admin', 'trainer', 'super_admin')
    ) THEN
      RAISE EXCEPTION 'Unauthorized: cannot award points to other users';
    END IF;
  END IF;

  -- ── 3. Input guard ───────────────────────────────────────────────────────────
  IF p_user_id IS NULL THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

  -- ── 4. Server-side points whitelist ─────────────────────────────────────────
  -- The client-sent p_points is intentionally IGNORED.
  -- All canonical values live here; the client cannot influence them.
  v_points := CASE p_action
    WHEN 'workout_completed'    THEN 50
    WHEN 'pr_hit'               THEN 20
    WHEN 'check_in'             THEN 20
    WHEN 'streak_day'           THEN LEAST(GREATEST(p_points, 20), 35)  -- variable 20-35, bounds enforced
    WHEN 'challenge_completed'  THEN 500
    WHEN 'achievement_unlocked' THEN 75
    WHEN 'weight_logged'        THEN 10
    WHEN 'first_weekly_workout' THEN 25
    WHEN 'streak_7'             THEN 200
    WHEN 'streak_30'            THEN 1000
    WHEN 'daily_challenge'      THEN 25
    WHEN 'challenge_joined'     THEN 25
    ELSE NULL
  END;

  -- Reject any action_type not explicitly listed above.
  -- To add a new action, add a WHEN clause here first.
  IF v_points IS NULL THEN
    RAISE EXCEPTION 'Unknown reward action: %', p_action;
  END IF;

  -- Guard against a derived zero (shouldn't happen with fixed values, but defensive)
  IF v_points <= 0 THEN
    RETURN json_build_object('total_points', 0, 'lifetime_points', 0);
  END IF;

  -- ── 5. Persist ───────────────────────────────────────────────────────────────
  -- Log entry
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
  VALUES (p_user_id, p_gym_id, p_action, v_points, COALESCE(p_description, p_action), NOW());

  -- Upsert running totals atomically
  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
  VALUES (p_user_id, p_gym_id, v_points, v_points, NOW())
  ON CONFLICT (profile_id) DO UPDATE SET
    total_points    = reward_points.total_points    + v_points,
    lifetime_points = reward_points.lifetime_points + v_points,
    last_updated    = NOW()
  RETURNING total_points, lifetime_points INTO new_total, new_lifetime;

  RETURN json_build_object('total_points', new_total, 'lifetime_points', new_lifetime);
END;
$$;

NOTIFY pgrst, 'reload schema';
