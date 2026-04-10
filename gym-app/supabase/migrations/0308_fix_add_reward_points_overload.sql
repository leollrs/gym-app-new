-- ============================================================
-- 0308: Fix add_reward_points function overload ambiguity
--
-- Problem: "function add_reward_points(uuid, uuid, unknown, integer, text)
-- is not unique" — multiple overloads exist in the live DB.
--
-- Fix: Drop ALL overloads and recreate the single canonical version.
-- ============================================================

-- Drop all possible overloads
DROP FUNCTION IF EXISTS public.add_reward_points(UUID, UUID, TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS public.add_reward_points(UUID, UUID, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.add_reward_points(UUID, UUID, VARCHAR, INT, TEXT);
DROP FUNCTION IF EXISTS public.add_reward_points(UUID, UUID, TEXT, INT);

-- Recreate the canonical version (from 0295_harden_add_reward_points_whitelist)
CREATE OR REPLACE FUNCTION public.add_reward_points(
  p_user_id     UUID,
  p_gym_id      UUID,
  p_action      TEXT,
  p_points      INT,
  p_description TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_caller_role TEXT;
  v_points INT;
  v_current_total INT;
  v_current_lifetime INT;
  v_new_total INT;
  v_new_lifetime INT;
BEGIN
  -- Caller must be authenticated
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Caller must be admin/trainer or self
  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller;
  IF v_caller != p_user_id AND v_caller_role NOT IN ('admin', 'super_admin', 'trainer') THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Server-side points lookup (ignores p_points parameter)
  v_points := CASE p_action
    WHEN 'workout'     THEN 50
    WHEN 'pr'          THEN 100
    WHEN 'check_in'    THEN 20
    WHEN 'streak'      THEN 10
    WHEN 'challenge'   THEN 500
    WHEN 'achievement' THEN 75
    WHEN 'referral'    THEN 200
    WHEN 'admin_gift'  THEN GREATEST(1, LEAST(p_points, 10000))
    ELSE NULL
  END;

  IF v_points IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid action: ' || COALESCE(p_action, 'NULL'));
  END IF;

  -- Log the points event
  INSERT INTO reward_points_log (profile_id, gym_id, action, points, description)
  VALUES (p_user_id, p_gym_id, p_action, v_points, p_description);

  -- Upsert running totals
  INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points)
  VALUES (p_user_id, p_gym_id, v_points, v_points)
  ON CONFLICT (profile_id)
  DO UPDATE SET
    total_points    = reward_points.total_points + v_points,
    lifetime_points = reward_points.lifetime_points + v_points
  RETURNING total_points, lifetime_points INTO v_new_total, v_new_lifetime;

  RETURN json_build_object(
    'success', true,
    'points_awarded', v_points,
    'total_points', v_new_total,
    'lifetime_points', v_new_lifetime
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_reward_points(UUID, UUID, TEXT, INT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
