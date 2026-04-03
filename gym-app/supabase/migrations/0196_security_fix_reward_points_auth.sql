-- Security fix: Revoke direct access to add_reward_points from authenticated users.
-- This function should only be called internally from other SECURITY DEFINER functions
-- (complete_workout, record_gym_purchase), not directly by end users.

REVOKE EXECUTE ON FUNCTION public.add_reward_points(UUID, UUID, TEXT, INT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.add_reward_points(UUID, UUID, TEXT, INT, TEXT) FROM anon;
