-- ============================================================
-- 0413 — Fix add_reward_points_checked return-type mismatch
--
-- 0254 declared add_reward_points_checked RETURNS INT and ended
-- with `RETURN add_reward_points(...)`. That worked when
-- add_reward_points itself returned INT — but 0308 changed
-- add_reward_points to RETURN JSON ({"total_points":N,
-- "lifetime_points":N}). Returning JSON from an INT-typed
-- function throws "cannot cast type json to integer" at
-- runtime, which the client's `supabase.rpc(...)` surfaces as
-- a non-zero error and (with the old client code) was silently
-- ignored. Result: every QR check-in scan reported success in
-- the UI ("+20pts") but no row in reward_points was actually
-- touched.
--
-- Fix: extract `total_points` from the JSON return as INT.
-- 0 still means "24h dedup hit"; any non-zero return means
-- points were awarded (the client only branches on `=== 0`).
-- ============================================================

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
SET search_path = public
AS $$
DECLARE
  v_last_checkin_points TIMESTAMPTZ;
  v_result              JSON;
BEGIN
  -- For check_in actions, enforce 24-hour limit
  IF p_action = 'check_in' THEN
    SELECT MAX(created_at) INTO v_last_checkin_points
    FROM reward_points_log
    WHERE profile_id = p_user_id
      AND action = 'check_in'
      AND created_at > now() - interval '24 hours';

    IF v_last_checkin_points IS NOT NULL THEN
      RETURN 0;
    END IF;
  END IF;

  -- Delegate to add_reward_points (returns JSON since 0308); pull
  -- the running total out as INT so the caller can keep treating
  -- the response as a numeric points count.
  v_result := add_reward_points(p_user_id, p_gym_id, p_action, p_points, p_description);
  RETURN COALESCE((v_result->>'total_points')::INT, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_reward_points_checked(UUID, UUID, TEXT, INT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
