-- ============================================================
-- 0470 — Fix choose_referral_reward points crediting
-- ============================================================
-- BUG: choose_referral_reward credited points by calling
--   add_reward_points(uid, gym, 'referral', cost_points, ...)
-- but 'referral' is NOT in add_reward_points' action whitelist
-- (workout_completed / pr_hit / check_in / streak_day /
--  challenge_completed / achievement_unlocked / weight_logged /
--  first_weekly_workout / streak_7 / streak_30 / daily_challenge /
--  challenge_joined). add_reward_points RAISEs 'Unknown reward action:
-- referral' on any unknown action — so a member choosing a points-type
-- referral reward got an error and no points.
--
-- Worse, add_reward_points uses a SERVER-side fixed points map and
-- IGNORES the passed amount — so even if 'referral' were whitelisted it
-- could never award the reward's variable cost_points.
--
-- FIX: credit points directly via reward_points + reward_points_log,
-- exactly as complete_referral / complete_referral_deferred already do
-- (action = 'referral' is a valid LOG value — those functions write it
-- every day). No behavioral change beyond "it no longer throws and the
-- correct variable amount lands". All other logic preserved verbatim.
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
  -- Must be the reward owner
  SELECT * INTO v_reward FROM referral_rewards
  WHERE id = p_reward_id AND profile_id = auth.uid();
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
