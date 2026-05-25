-- Fix unpause_gym 400 error (42804): COALESCE(pre_pause_status, 'active') yields
-- TEXT (pre_pause_status is a TEXT column), but membership_status is an enum.
-- Postgres won't implicitly cast text -> enum on assignment, so the UPDATE failed
-- with "column membership_status is of type membership_status but expression is of
-- type text". Cast the restored value explicitly.

CREATE OR REPLACE FUNCTION public.unpause_gym(p_gym_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super_admin role required';
  END IF;

  -- Reactivate the gym itself (reset cancelled tier to free as well)
  UPDATE gyms
  SET    is_active        = TRUE,
         subscription_tier = CASE
           WHEN subscription_tier = 'cancelled' THEN 'free'
           ELSE subscription_tier
         END
  WHERE  id = p_gym_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gym not found';
  END IF;

  -- Restore each member's pre-pause status; fall back to 'active' if missing.
  -- Cast to the enum type since pre_pause_status is stored as TEXT.
  UPDATE profiles
  SET    membership_status = COALESCE(pre_pause_status, 'active')::membership_status,
         pre_pause_status  = NULL
  WHERE  gym_id = p_gym_id
    AND  role <> 'super_admin';
END;
$$;

GRANT EXECUTE ON FUNCTION public.unpause_gym(UUID) TO authenticated;
