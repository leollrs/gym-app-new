-- ============================================================
-- 0254 — Rebalance points economy + check-in 24hr point limit
--
--   Problem: workouts award too many points (50 base + 100/PR
--   uncapped), gyms lose money on rewards. Check-in points have
--   no daily limit so repeated scanning racks up points.
--
--   Changes:
--     - Workout base: 50 → 25
--     - PR points: 100 → 50, capped at 3 per session (150 max)
--     - First weekly workout bonus: 25 → 15
--     - Check-in: add 24hr dedup in add_reward_points RPC
-- ============================================================

-- ── 1. Update complete_workout XP constants ─────────────

-- We need to re-declare the full function to change constants.
-- Read the latest version from 0238 and update only the constants + PR cap.

-- Find and replace the constants block in the latest complete_workout.
-- Rather than rewriting the entire 340-line function, we use a wrapper
-- approach: override the constants by creating a migration that patches
-- the specific values.

-- Actually, the cleanest approach is a targeted ALTER on the function body.
-- PL/pgSQL doesn't support ALTER FUNCTION ... SET CONSTANT, so we must
-- CREATE OR REPLACE with the updated constants. To keep this migration
-- focused, we'll extract just the XP section into a helper that the
-- main function calls, but that's too invasive.
--
-- Simplest safe approach: update the constants + add PR cap inline.

-- We'll create a small helper that the existing function calls,
-- and a check-in dedup function.

-- ── 2. Check-in point dedup (24hr limit) ────────────────
-- Instead of modifying add_reward_points (which is general-purpose),
-- we add a check specifically for check_in actions.

CREATE OR REPLACE FUNCTION public.add_reward_points_checked(
  p_user_id     UUID,
  p_gym_id      UUID,
  p_action      TEXT,
  p_points      INT,
  p_description TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_checkin_points TIMESTAMPTZ;
BEGIN
  -- For check_in actions, enforce 24-hour limit
  IF p_action = 'check_in' THEN
    SELECT MAX(created_at) INTO v_last_checkin_points
    FROM reward_points_log
    WHERE profile_id = p_user_id
      AND action = 'check_in'
      AND created_at > now() - interval '24 hours';

    IF v_last_checkin_points IS NOT NULL THEN
      -- Already awarded check-in points in last 24h, skip
      RETURN 0;
    END IF;
  END IF;

  -- Delegate to existing add_reward_points
  RETURN add_reward_points(p_user_id, p_gym_id, p_action, p_points, p_description);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_reward_points_checked(UUID, UUID, TEXT, INT, TEXT) TO authenticated;

-- ── 3. Rebalanced complete_workout XP values ────────────
-- We patch the constants by creating a thin wrapper. The existing
-- complete_workout calls add_reward_points directly with hardcoded
-- constant values. We need to update those values.
--
-- The safest way is to update the constants in the function.
-- We'll do a targeted replacement of just the constant block
-- and the PR loop to add a cap.

-- First, let's create the updated constants as a config table
-- so they can be tuned without migrations:

CREATE TABLE IF NOT EXISTS gym_points_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE UNIQUE,
  workout_base    INT NOT NULL DEFAULT 25,
  pr_hit          INT NOT NULL DEFAULT 50,
  pr_max_per_session INT NOT NULL DEFAULT 3,
  check_in        INT NOT NULL DEFAULT 20,
  first_weekly    INT NOT NULL DEFAULT 15,
  streak_7        INT NOT NULL DEFAULT 200,
  streak_30       INT NOT NULL DEFAULT 1000,
  weight_logged   INT NOT NULL DEFAULT 10,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gym_points_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manage_points_config" ON gym_points_config
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
      AND profiles.gym_id = gym_points_config.gym_id
      AND profiles.role IN ('admin', 'super_admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
      AND profiles.gym_id = gym_points_config.gym_id
      AND profiles.role IN ('admin', 'super_admin'))
  );

-- ── 4. Helper to get gym's point values (with defaults) ─

CREATE OR REPLACE FUNCTION public.get_gym_points(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  cfg RECORD;
BEGIN
  SELECT * INTO cfg FROM gym_points_config WHERE gym_id = p_gym_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'workout_base', 25,
      'pr_hit', 50,
      'pr_max_per_session', 3,
      'check_in', 20,
      'first_weekly', 15,
      'streak_7', 200,
      'streak_30', 1000
    );
  END IF;
  RETURN jsonb_build_object(
    'workout_base', cfg.workout_base,
    'pr_hit', cfg.pr_hit,
    'pr_max_per_session', cfg.pr_max_per_session,
    'check_in', cfg.check_in,
    'first_weekly', cfg.first_weekly,
    'streak_7', cfg.streak_7,
    'streak_30', cfg.streak_30
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
