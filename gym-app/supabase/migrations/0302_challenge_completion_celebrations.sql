-- ============================================================
-- Challenge Completion Celebrations
-- Adds winner notifications, activity feed items, and
-- participant summary notifications to award_challenge_prizes
-- ============================================================

CREATE OR REPLACE FUNCTION award_challenge_prizes(p_challenge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge RECORD;
  v_caller_gym UUID;
  v_caller_role TEXT;
  v_rewards JSONB;
  v_participants RECORD;
  v_top3 UUID[];
  v_result JSONB := '[]'::JSONB;
  v_reward JSONB;
  v_place INT;
  v_points INT;
  v_prize TEXT;
  v_product_id UUID;
  v_reward_type TEXT;
  v_reward_label TEXT;
  v_qr TEXT;
  v_prize_id UUID;
  v_row RECORD;
BEGIN
  -- Verify caller is admin
  SELECT gym_id, role INTO v_caller_gym, v_caller_role
  FROM profiles WHERE id = auth.uid();

  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only admins can award prizes';
  END IF;

  -- Get the challenge
  SELECT * INTO v_challenge
  FROM challenges WHERE id = p_challenge_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found';
  END IF;

  IF v_challenge.gym_id != v_caller_gym AND v_caller_role != 'super_admin' THEN
    RAISE EXCEPTION 'Not authorized for this gym';
  END IF;

  -- Check if prizes already awarded
  IF EXISTS (SELECT 1 FROM challenge_prizes WHERE challenge_id = p_challenge_id) THEN
    RAISE EXCEPTION 'Prizes have already been awarded for this challenge';
  END IF;

  -- Parse rewards JSON
  BEGIN
    v_rewards := v_challenge.reward_description::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_rewards := NULL;
  END;

  IF v_rewards IS NULL OR jsonb_array_length(v_rewards) = 0 THEN
    RAISE EXCEPTION 'No rewards configured for this challenge';
  END IF;

  -- Get top 3 participants by score
  FOR v_row IN
    SELECT cp.profile_id, cp.score
    FROM challenge_participants cp
    WHERE cp.challenge_id = p_challenge_id
    ORDER BY cp.score DESC
    LIMIT 3
  LOOP
    v_place := array_length(v_top3, 1);
    IF v_place IS NULL THEN v_place := 0; END IF;
    v_place := v_place + 1;
    v_top3 := array_append(v_top3, v_row.profile_id);

    -- Get reward config for this placement (0-indexed in JSON array)
    IF v_place <= jsonb_array_length(v_rewards) THEN
      v_reward := v_rewards->(v_place - 1);
    ELSE
      CONTINUE;
    END IF;

    v_points := COALESCE((v_reward->>'points')::INT, 0);
    v_prize := v_reward->>'prize';
    v_product_id := NULLIF(v_reward->>'product_id', '')::UUID;

    -- Determine reward type and label
    IF v_product_id IS NOT NULL THEN
      v_reward_type := 'product';
      v_reward_label := COALESCE(v_prize, 'Product prize');
      IF v_points > 0 THEN
        v_reward_label := v_points || ' pts + ' || v_reward_label;
      END IF;
    ELSIF v_prize IS NOT NULL AND v_prize != '' THEN
      v_reward_type := 'custom';
      v_reward_label := v_prize;
      IF v_points > 0 THEN
        v_reward_label := v_points || ' pts + ' || v_reward_label;
      END IF;
    ELSE
      v_reward_type := 'points';
      v_reward_label := v_points || ' pts';
    END IF;

    -- Generate QR code for product/custom prizes
    v_qr := NULL;
    IF v_reward_type IN ('product', 'custom') THEN
      v_qr := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
    END IF;

    -- Award points if specified
    IF v_points > 0 THEN
      -- Add to reward_points
      UPDATE reward_points
      SET total_points = total_points + v_points,
          lifetime_points = lifetime_points + v_points,
          updated_at = NOW()
      WHERE profile_id = v_row.profile_id;

      -- If no row existed, insert one
      IF NOT FOUND THEN
        INSERT INTO reward_points (profile_id, total_points, lifetime_points)
        VALUES (v_row.profile_id, v_points, v_points);
      END IF;

      -- Log the points
      INSERT INTO reward_points_log (profile_id, points, action, description)
      VALUES (
        v_row.profile_id,
        v_points,
        'challenge_completed',
        'Challenge prize: ' || v_challenge.name || ' (' || v_place || CASE v_place WHEN 1 THEN 'st' WHEN 2 THEN 'nd' ELSE 'rd' END || ' place)'
      );
    END IF;

    -- Insert challenge prize row
    INSERT INTO challenge_prizes (
      gym_id, challenge_id, profile_id, placement,
      reward_type, reward_label, points_awarded,
      product_id, qr_code, status
    ) VALUES (
      v_challenge.gym_id, p_challenge_id, v_row.profile_id, v_place,
      v_reward_type, v_reward_label, v_points,
      v_product_id, v_qr, 'pending'
    )
    RETURNING id INTO v_prize_id;

    -- Notify the winner
    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
    VALUES (
      v_row.profile_id,
      v_challenge.gym_id,
      'challenge_update',
      CASE v_place WHEN 1 THEN '🥇 You won!' WHEN 2 THEN '🥈 2nd place!' ELSE '🥉 3rd place!' END,
      'You placed ' || v_place || CASE v_place WHEN 1 THEN 'st' WHEN 2 THEN 'nd' ELSE 'rd' END || ' in ' || v_challenge.name || '! ' || v_reward_label,
      'challenge_prize_' || p_challenge_id || '_' || v_row.profile_id
    );

    -- Insert activity feed item for the win
    INSERT INTO activity_feed_items (gym_id, actor_id, type, is_public, data)
    VALUES (
      v_challenge.gym_id,
      v_row.profile_id,
      'challenge_won',
      true,
      jsonb_build_object(
        'challenge_id', p_challenge_id,
        'challenge_name', v_challenge.name,
        'placement', v_place,
        'reward_label', v_reward_label
      )
    );

    v_result := v_result || jsonb_build_object(
      'prize_id', v_prize_id,
      'profile_id', v_row.profile_id,
      'placement', v_place,
      'reward_type', v_reward_type,
      'reward_label', v_reward_label,
      'points_awarded', v_points,
      'qr_code', v_qr
    );
  END LOOP;

  -- Notify all other participants that the challenge has ended
  INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
  SELECT
    cp.profile_id,
    v_challenge.gym_id,
    'challenge_update',
    v_challenge.name || ' has ended!',
    'Check the final results and see who won.',
    'challenge_ended_' || p_challenge_id || '_' || cp.profile_id
  FROM challenge_participants cp
  WHERE cp.challenge_id = p_challenge_id
    AND cp.profile_id != ALL(v_top3);  -- Don't double-notify winners

  NOTIFY pgrst, 'reload schema';

  RETURN v_result;
END;
$$;
