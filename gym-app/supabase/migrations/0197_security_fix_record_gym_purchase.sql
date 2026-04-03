-- Security fix: replace record_gym_purchase with proper authorization checks.
-- The original function (0085) was SECURITY DEFINER with no auth checks,
-- allowing any authenticated user to record purchases for any member in any gym.
-- Migration 0140 added checks using helper functions, but this migration
-- switches to direct profile_lookup table verification and enforces that
-- p_recorded_by matches the authenticated caller.

CREATE OR REPLACE FUNCTION public.record_gym_purchase(
  p_gym_id      UUID,
  p_member_id   UUID,
  p_product_id  UUID,
  p_recorded_by UUID,
  p_quantity    INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product          RECORD;
  v_purchase_id      UUID;
  v_points_earned    INTEGER;
  v_total_price      NUMERIC(8,2);
  v_punch_current    INTEGER := 0;
  v_punch_target     INTEGER;
  v_free_earned      BOOLEAN := FALSE;
  v_free_purchase_id UUID;
  v_punch_card       RECORD;
  v_punch_changed    BOOLEAN := FALSE;
BEGIN
  -- Verify caller is admin of the target gym
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_lookup
    WHERE id = auth.uid() AND gym_id = p_gym_id AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Only gym admins can record purchases';
  END IF;

  -- Also enforce that p_recorded_by matches the caller
  IF p_recorded_by != auth.uid() THEN
    RAISE EXCEPTION 'recorded_by must match the authenticated user';
  END IF;

  -- 1. Look up the product
  SELECT price, points_per_purchase, punch_card_enabled, punch_card_target
  INTO v_product
  FROM gym_products
  WHERE id = p_product_id AND gym_id = p_gym_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found or inactive';
  END IF;

  v_total_price   := v_product.price * p_quantity;
  v_points_earned := v_product.points_per_purchase * p_quantity;

  -- 2. Insert the purchase record
  INSERT INTO member_purchases (gym_id, member_id, product_id, recorded_by, quantity, total_price, points_earned, is_free_reward)
  VALUES (p_gym_id, p_member_id, p_product_id, p_recorded_by, p_quantity, v_total_price, v_points_earned, FALSE)
  RETURNING id INTO v_purchase_id;

  -- 3. Handle punch card if enabled
  IF v_product.punch_card_enabled THEN
    v_punch_target := COALESCE(v_product.punch_card_target, 10);
    v_punch_changed := TRUE;

    -- Upsert punch card, incrementing punches
    INSERT INTO member_punch_cards (gym_id, member_id, product_id, punches, total_completed)
    VALUES (p_gym_id, p_member_id, p_product_id, p_quantity, 0)
    ON CONFLICT (gym_id, member_id, product_id) DO UPDATE SET
      punches    = member_punch_cards.punches + p_quantity,
      updated_at = NOW()
    RETURNING punches, total_completed INTO v_punch_card;

    v_punch_current := v_punch_card.punches;

    -- Check if punch card is complete
    IF v_punch_current >= v_punch_target THEN
      v_free_earned := TRUE;

      -- Reset punches and increment total_completed
      UPDATE member_punch_cards
      SET punches         = v_punch_current - v_punch_target,
          total_completed = v_punch_card.total_completed + 1,
          updated_at      = NOW()
      WHERE gym_id = p_gym_id AND member_id = p_member_id AND product_id = p_product_id;

      -- Record the free item
      INSERT INTO member_purchases (gym_id, member_id, product_id, recorded_by, quantity, total_price, points_earned, is_free_reward)
      VALUES (p_gym_id, p_member_id, p_product_id, p_recorded_by, 1, 0, 0, TRUE)
      RETURNING id INTO v_free_purchase_id;

      -- Re-read the current punches after reset
      v_punch_current := v_punch_current - v_punch_target;
    END IF;
  END IF;

  -- 4. Award reward points (same pattern as add_reward_points)
  IF v_points_earned > 0 THEN
    INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
    VALUES (p_member_id, p_gym_id, 'store_purchase', v_points_earned,
            'Store purchase: ' || p_quantity || 'x item', NOW());

    INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
    VALUES (p_member_id, p_gym_id, v_points_earned, v_points_earned, NOW())
    ON CONFLICT (profile_id) DO UPDATE SET
      total_points    = reward_points.total_points + v_points_earned,
      lifetime_points = reward_points.lifetime_points + v_points_earned,
      last_updated    = NOW();
  END IF;

  -- 5. Trigger wallet pass push update if punch card changed
  IF v_punch_changed THEN
    PERFORM public.notify_wallet_pass_update(
      p_member_id,
      CASE WHEN v_free_earned THEN 'free_reward_earned' ELSE 'punch_card_update' END
    );
  END IF;

  -- 6. Return result
  RETURN jsonb_build_object(
    'purchase_id',         v_purchase_id,
    'points_earned',       v_points_earned,
    'punch_card_progress', CASE
      WHEN v_product.punch_card_enabled THEN jsonb_build_object(
        'current_punches', v_punch_current,
        'target',          COALESCE(v_product.punch_card_target, 10)
      )
      ELSE NULL
    END,
    'free_item_earned',    v_free_earned
  );
END;
$$;
