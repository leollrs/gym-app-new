-- Fix privilege escalation: remove trainer role from admin_gift_reward()
-- Trainers should NOT be able to gift rewards — this is an admin-only action.

CREATE OR REPLACE FUNCTION public.admin_gift_reward(
  p_member_id   UUID,
  p_gym_id      UUID,
  p_reward_id   TEXT,
  p_reward_name TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id   UUID;
  v_admin_role TEXT;
  v_admin_gym  UUID;
  v_redeem_id  UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, gym_id INTO v_admin_role, v_admin_gym
  FROM profiles WHERE id = v_admin_id;

  IF v_admin_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Verify member belongs to admin's gym (or admin is super_admin)
  IF v_admin_role != 'super_admin' THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = p_member_id AND gym_id = v_admin_gym
    ) THEN
      RAISE EXCEPTION 'Member not in your gym';
    END IF;
  END IF;

  INSERT INTO reward_redemptions (profile_id, gym_id, reward_id, reward_name, points_spent, status)
  VALUES (p_member_id, p_gym_id, p_reward_id, p_reward_name, 0, 'pending')
  RETURNING id INTO v_redeem_id;

  RETURN json_build_object(
    'redemption_id', v_redeem_id,
    'success', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_gift_reward(UUID, UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
