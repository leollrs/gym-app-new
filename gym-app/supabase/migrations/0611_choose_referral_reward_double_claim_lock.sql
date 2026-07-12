-- ============================================================
-- 0611 — choose_referral_reward: close the double-claim race
-- ============================================================
-- BUG (TOCTOU): choose_referral_reward reads the reward row, checks
-- `choice_status != 'pending'`, then UPDATEs + credits points — with NO
-- lock between the read and the write. Two concurrent calls (double-tap,
-- retried request, two devices) can BOTH pass the pending check and BOTH
-- run the points INSERT, crediting the reward twice from one earned referral.
--
-- FIX: take a row lock on the referral_rewards row at read time
-- (`FOR UPDATE`). The second caller now blocks until the first commits,
-- then re-reads choice_status = 'chosen' and returns "already chosen" — so
-- the points path runs at most once. Body is otherwise reproduced VERBATIM
-- from 0470 (the authoritative definition); the only change is `FOR UPDATE`
-- on the owner SELECT.
--
-- Note: auth.uid() scoping + the pending-status guard are unchanged, so this
-- is purely a serialization hardening — no behavioral change on the happy path.
-- ============================================================

CREATE OR REPLACE FUNCTION public.choose_referral_reward(p_reward_id uuid, p_gym_reward_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reward RECORD;
  v_gym_reward RECORD;
BEGIN
  -- Must be the reward owner. FOR UPDATE serializes concurrent claims on the
  -- SAME reward so the pending-check + points-credit below can't both run twice.
  SELECT * INTO v_reward FROM referral_rewards
  WHERE id = p_reward_id AND profile_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Reward not found');
  END IF;

  IF v_reward.choice_status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Reward already chosen');
  END IF;

  -- Validate gym reward exists and is active
  SELECT * INTO v_gym_reward FROM gym_rewards
  WHERE id = p_gym_reward_id AND gym_id = v_reward.gym_id AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid reward option');
  END IF;

  -- Update with choice
  UPDATE referral_rewards
  SET reward_type = v_gym_reward.reward_type,
      reward_value = jsonb_build_object(
        'gym_reward_id', v_gym_reward.id,
        'name', v_gym_reward.name,
        'emoji', v_gym_reward.emoji_icon,
        'type', v_gym_reward.reward_type,
        'points', v_gym_reward.cost_points
      ),
      choice_status = 'chosen',
      chosen_at = now(),
      gym_reward_id = v_gym_reward.id
  WHERE id = p_reward_id;

  -- If reward is points-based, credit the points DIRECTLY (matching the
  -- complete_referral / complete_referral_deferred pattern). add_reward_points
  -- can't be used here: 'referral' isn't in its action whitelist and it
  -- ignores the variable amount.
  IF v_gym_reward.reward_type = 'points' OR v_gym_reward.cost_points > 0 THEN
    IF v_gym_reward.cost_points > 0 THEN
      INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
      VALUES (auth.uid(), v_reward.gym_id, 'referral', v_gym_reward.cost_points,
              'Referral reward: ' || v_gym_reward.name, NOW());

      INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
      VALUES (auth.uid(), v_reward.gym_id, v_gym_reward.cost_points, v_gym_reward.cost_points, NOW())
      ON CONFLICT (profile_id) DO UPDATE SET
        total_points    = reward_points.total_points    + v_gym_reward.cost_points,
        lifetime_points = reward_points.lifetime_points + v_gym_reward.cost_points,
        last_updated    = NOW();
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reward_name', v_gym_reward.name,
    'reward_type', v_gym_reward.reward_type
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
