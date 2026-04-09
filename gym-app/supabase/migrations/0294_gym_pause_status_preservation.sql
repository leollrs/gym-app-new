-- S19: Preserve membership_status history across gym pause/reactivate
-- Adds pre_pause_status column and transactional RPCs for pause and unpause.

-- ── Schema change ─────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pre_pause_status TEXT DEFAULT NULL;

-- ── pause_gym ─────────────────────────────────────────────────────────────────
-- Saves each member's current membership_status into pre_pause_status, then
-- sets them all to 'deactivated'.  Also marks the gym inactive.

CREATE OR REPLACE FUNCTION public.pause_gym(p_gym_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super_admin role required';
  END IF;

  -- Deactivate the gym itself
  UPDATE gyms
  SET    is_active = FALSE
  WHERE  id = p_gym_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gym not found';
  END IF;

  -- Snapshot each member's current status, then set to deactivated
  UPDATE profiles
  SET    pre_pause_status = membership_status,
         membership_status = 'deactivated'
  WHERE  gym_id = p_gym_id
    AND  role <> 'super_admin';
END;
$$;

-- ── unpause_gym ───────────────────────────────────────────────────────────────
-- Restores each member's membership_status from pre_pause_status (or falls
-- back to 'active' if the snapshot is missing), then clears pre_pause_status.
-- Also marks the gym active.

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

  -- Restore each member's pre-pause status; fall back to 'active' if missing
  UPDATE profiles
  SET    membership_status = COALESCE(pre_pause_status, 'active'),
         pre_pause_status  = NULL
  WHERE  gym_id = p_gym_id
    AND  role <> 'super_admin';
END;
$$;

-- Grant execute to authenticated users (super_admin check is inside the functions)
GRANT EXECUTE ON FUNCTION public.pause_gym(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpause_gym(UUID) TO authenticated;
