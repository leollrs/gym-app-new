-- 0609 — Close the redeem_reward points-overspend race (Audit P1)
-- ============================================================
-- redeem_reward computes available = total_points - SUM(pending redemptions),
-- checks it against the cost, then INSERTs a new pending redemption — with NO
-- lock. Two concurrent calls for the same member both read the same pre-insert
-- `v_held`, both pass the balance check, and both insert, so the member can
-- hold pending redemptions that together exceed their balance and then have
-- staff claim both = points overspend (points redeem for real merch / free
-- months).
--
-- Fix: acquire a per-member transaction-scoped advisory lock right after
-- resolving auth.uid(), so the available-points check and the pending-redemption
-- INSERT are atomic per member. Only serializes a single member's concurrent
-- redeems (zero contention across members; same-member concurrency is rare and
-- exactly the abuse vector). Released automatically at commit/rollback.
--
-- Body is reproduced verbatim from 0309 (the live definition — no later
-- migration redefines redeem_reward) with only the PERFORM lock line added.

CREATE OR REPLACE FUNCTION public.redeem_reward(
  p_reward_id   TEXT,
  p_reward_name TEXT,
  p_cost        INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_gym_id      UUID;
  v_total       INT;
  v_held        INT;
  v_available   INT;
  v_redeem_id   UUID;
  v_actual_cost INT;
  v_reward_found BOOLEAN := FALSE;
BEGIN
  IF p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid reward cost';
  END IF;

  -- Server-side cost lookup from gym_rewards catalog
  BEGIN
    SELECT cost_points INTO v_actual_cost
      FROM gym_rewards
     WHERE id = p_reward_id::uuid
       AND is_active = true;
    IF FOUND THEN v_reward_found := TRUE; END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT cost_points INTO v_actual_cost
      FROM gym_rewards
     WHERE reward_type = p_reward_id
       AND is_active = true
     LIMIT 1;
    IF FOUND THEN v_reward_found := TRUE; END IF;
  END;

  IF v_reward_found THEN
    IF v_actual_cost != p_cost THEN
      RAISE EXCEPTION 'Cost mismatch: client sent %, catalog requires %', p_cost, v_actual_cost;
    END IF;
    p_cost := v_actual_cost;
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── ADDED (0609): serialize this member's redemptions ──────────────────
  -- Makes the available-points check + pending INSERT below atomic per member,
  -- closing the concurrent-overspend race. No-op for different members.
  PERFORM pg_advisory_xact_lock(hashtext('redeem_reward:' || v_user_id::text));

  SELECT gym_id INTO v_gym_id FROM profiles WHERE id = v_user_id;
  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- Check available points (total minus held)
  SELECT COALESCE(total_points, 0) INTO v_total
    FROM reward_points WHERE profile_id = v_user_id;

  SELECT COALESCE(SUM(points_spent), 0) INTO v_held
    FROM reward_redemptions
   WHERE profile_id = v_user_id
     AND status = 'pending';

  v_available := v_total - v_held;

  IF v_available < p_cost THEN
    RAISE EXCEPTION 'Insufficient points: have %, need %', v_available, p_cost;
  END IF;

  -- Create redemption record (pending until staff confirms)
  INSERT INTO reward_redemptions (profile_id, gym_id, reward_id, reward_name, points_spent, status)
  VALUES (v_user_id, v_gym_id, p_reward_id, p_reward_name, p_cost, 'pending')
  RETURNING id INTO v_redeem_id;

  RETURN json_build_object(
    'success', true,
    'redemption_id', v_redeem_id,
    'points_remaining', v_available - p_cost
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_reward(TEXT, TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
