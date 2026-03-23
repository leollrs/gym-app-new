-- =============================================================
-- GYM STORE & PUNCH CARD PURCHASES
-- Migration: 0081_gym_store_purchases.sql
--
-- Adds gym product catalog, member purchase tracking, and
-- punch card loyalty system. Integrates with existing
-- reward_points / reward_points_log for points earning.
-- =============================================================

-- ── 1. gym_products — Product catalog per gym ─────────────────

CREATE TABLE IF NOT EXISTS gym_products (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id              UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    category            TEXT NOT NULL DEFAULT 'general',
    price               NUMERIC(8,2) NOT NULL,
    points_per_purchase INTEGER NOT NULL DEFAULT 10,
    emoji_icon          TEXT DEFAULT '🛒',
    punch_card_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    punch_card_target   INTEGER DEFAULT 10,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(gym_id, name)
);

ALTER TABLE gym_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gym_products_admin" ON gym_products
  FOR ALL USING (
    gym_id = public.current_gym_id() AND public.is_admin()
  );

CREATE POLICY "gym_products_member_select" ON gym_products
  FOR SELECT USING (
    gym_id = public.current_gym_id() AND is_active = TRUE
  );

CREATE POLICY "gym_products_super_admin" ON gym_products
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 2. member_purchases — Individual purchase records ─────────

CREATE TABLE IF NOT EXISTS member_purchases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES gym_products(id) ON DELETE CASCADE,
    recorded_by     UUID NOT NULL REFERENCES profiles(id),
    quantity        INTEGER NOT NULL DEFAULT 1,
    total_price     NUMERIC(8,2) NOT NULL,
    points_earned   INTEGER NOT NULL DEFAULT 0,
    is_free_reward  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_purchases_gym_member
  ON member_purchases(gym_id, member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_purchases_product
  ON member_purchases(product_id);

ALTER TABLE member_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_purchases_admin" ON member_purchases
  FOR ALL USING (
    gym_id = public.current_gym_id() AND public.is_admin()
  );

CREATE POLICY "member_purchases_member_select" ON member_purchases
  FOR SELECT USING (
    gym_id = public.current_gym_id() AND member_id = auth.uid()
  );

CREATE POLICY "member_purchases_super_admin" ON member_purchases
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 3. member_punch_cards — Punch card progress ──────────────

CREATE TABLE IF NOT EXISTS member_punch_cards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id          UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES gym_products(id) ON DELETE CASCADE,
    punches         INTEGER NOT NULL DEFAULT 0,
    total_completed INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(gym_id, member_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_member_punch_cards_lookup
  ON member_punch_cards(gym_id, member_id);

ALTER TABLE member_punch_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_punch_cards_admin" ON member_punch_cards
  FOR ALL USING (
    gym_id = public.current_gym_id() AND public.is_admin()
  );

CREATE POLICY "member_punch_cards_member_select" ON member_punch_cards
  FOR SELECT USING (
    gym_id = public.current_gym_id() AND member_id = auth.uid()
  );

CREATE POLICY "member_punch_cards_super_admin" ON member_punch_cards
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 4. record_gym_purchase RPC ────────────────────────────────

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
BEGIN
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

  -- 5. Return result
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

GRANT EXECUTE ON FUNCTION public.record_gym_purchase(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
