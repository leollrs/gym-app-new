-- =============================================================
-- PURCHASE APPROVAL QUEUE
-- Migration: 0602_purchase_approval_queue.sql
--
-- Store purchases (incl. punch-card products) become an ASYNC
-- approval queue. A scanned/recorded purchase is now logged as
-- PENDING and grants NOTHING — no reward points, no punch-card
-- increment, no free reward, no wallet push — until an owner/admin
-- approves it in the new admin queue.
--
-- 1. member_purchases gains status / approved_by / approved_at.
--    Existing rows backfill to 'approved' (they were already granted
--    by the old atomic record_gym_purchase).
-- 2. record_gym_purchase is redefined to INSERT the row as 'pending'
--    and do nothing else (keeps the admin-only + gym-scope checks,
--    advisory lock, quantity validation from 0463).
-- 3. approve_gym_purchase(p_purchase_id) runs the granting logic that
--    used to live in record_gym_purchase (points + punch card + free
--    reward + wallet push). Idempotent — guards on status so it can
--    never double-grant.
-- 4. reject_gym_purchase(p_purchase_id) marks the row rejected and
--    grants nothing.
-- =============================================================

-- ── 1. Schema — status / approver columns ────────────────────
ALTER TABLE public.member_purchases
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Backfill: every pre-existing purchase was already granted by the old
-- atomic record_gym_purchase, so it is effectively approved. Do this
-- BEFORE adding the CHECK so the default 'pending' on legacy rows is
-- corrected and the constraint validates cleanly.
UPDATE public.member_purchases
SET status = 'approved'
WHERE status = 'pending'
  AND created_at < NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_purchases_status_check'
  ) THEN
    ALTER TABLE public.member_purchases
      ADD CONSTRAINT member_purchases_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- Fast lookup of a gym's pending queue (and status filters generally).
CREATE INDEX IF NOT EXISTS idx_member_purchases_gym_status
  ON public.member_purchases(gym_id, status);

-- ── 2. record_gym_purchase — record as PENDING, grant nothing ─
--     Preserves the 0463 security model: multi-role admin check on
--     profiles (+additional_roles), recorded_by must be the caller,
--     per-(member,product) advisory lock, quantity 1..1000, and
--     SET search_path = public.
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
  v_product       RECORD;
  v_purchase_id   UUID;
  v_points_earned INTEGER;
  v_total_price   NUMERIC(8,2);
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 1000';
  END IF;

  -- Admin (or super_admin) of the target gym only. profile_lookup mirrors
  -- profiles 1:1 but lacks additional_roles, so check profiles directly to
  -- honour the multi-role expansion (matches 0463).
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'Only gym admins can record purchases';
  END IF;

  IF p_recorded_by != auth.uid() THEN
    RAISE EXCEPTION 'recorded_by must match the authenticated user';
  END IF;

  -- Look up the product (price/points snapshotted onto the pending row).
  SELECT price, points_per_purchase, punch_card_enabled, punch_card_target
    INTO v_product
    FROM gym_products
   WHERE id = p_product_id AND gym_id = p_gym_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found or inactive';
  END IF;

  v_total_price   := v_product.price * p_quantity;
  v_points_earned := v_product.points_per_purchase * p_quantity;

  -- Record as PENDING. Grant NOTHING here: no reward points, no punch-card
  -- increment, no free reward, no wallet push. All of that happens in
  -- approve_gym_purchase once an owner/admin approves the queued item.
  INSERT INTO member_purchases (gym_id, member_id, product_id, recorded_by, quantity, total_price, points_earned, is_free_reward, status)
  VALUES (p_gym_id, p_member_id, p_product_id, p_recorded_by, p_quantity, v_total_price, v_points_earned, FALSE, 'pending')
  RETURNING id INTO v_purchase_id;

  RETURN jsonb_build_object(
    'purchase_id',  v_purchase_id,
    'status',       'pending',
    'points_earned', v_points_earned,
    'total_price',  v_total_price
  );
END;
$$;

-- ── 3. approve_gym_purchase — grant on approval (idempotent) ──
--     Flips a pending row to approved and THEN runs the granting logic
--     that used to live in record_gym_purchase: award reward points,
--     increment / complete the punch card (+ free reward), wallet push.
--     Guards on status so a double-call never double-grants.
CREATE OR REPLACE FUNCTION public.approve_gym_purchase(
  p_purchase_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase         RECORD;
  v_product          RECORD;
  v_points_earned    INTEGER := 0;
  v_punch_current    INTEGER := 0;
  v_punch_target     INTEGER;
  v_free_earned      BOOLEAN := FALSE;
  v_free_purchase_id UUID;
  v_punch_card       RECORD;
  v_punch_changed    BOOLEAN := FALSE;
  v_product_found    BOOLEAN := FALSE;
BEGIN
  -- Load the purchase (lock it so concurrent approve/reject serialise).
  SELECT * INTO v_purchase
    FROM member_purchases
   WHERE id = p_purchase_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;

  -- Admin (or super_admin) of the purchase's gym only — same multi-role
  -- check used for recording.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND gym_id = v_purchase.gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'Only gym admins can approve purchases';
  END IF;

  -- Idempotency guard: only a still-pending row grants. A re-approve (or
  -- approve-after-reject) is a harmless no-op that reports the final state.
  IF v_purchase.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'purchase_id',  v_purchase.id,
      'status',       v_purchase.status,
      'already_done', TRUE
    );
  END IF;

  -- Per-(member, product) advisory lock — same guard the old atomic path
  -- used to prevent a punch-card race / double free reward.
  PERFORM pg_advisory_xact_lock(
    hashtext(v_purchase.member_id::text || ':' || v_purchase.product_id::text)
  );

  -- Flip to approved up front so the granting below is bound to this row.
  UPDATE member_purchases
  SET status      = 'approved',
      approved_by = auth.uid(),
      approved_at = NOW()
  WHERE id = v_purchase.id;

  v_points_earned := COALESCE(v_purchase.points_earned, 0);

  -- Product is needed for punch-card config.
  SELECT price, points_per_purchase, punch_card_enabled, punch_card_target
    INTO v_product
    FROM gym_products
   WHERE id = v_purchase.product_id;
  v_product_found := FOUND;

  -- 1. Punch card — increment, and on completion reset + free reward.
  IF v_product_found AND v_product.punch_card_enabled THEN
    v_punch_target := COALESCE(v_product.punch_card_target, 10);
    v_punch_changed := TRUE;

    INSERT INTO member_punch_cards (gym_id, member_id, product_id, punches, total_completed)
    VALUES (v_purchase.gym_id, v_purchase.member_id, v_purchase.product_id, v_purchase.quantity, 0)
    ON CONFLICT (gym_id, member_id, product_id) DO UPDATE SET
      punches    = member_punch_cards.punches + v_purchase.quantity,
      updated_at = NOW()
    RETURNING punches, total_completed INTO v_punch_card;

    v_punch_current := v_punch_card.punches;

    IF v_punch_current >= v_punch_target THEN
      v_free_earned := TRUE;

      UPDATE member_punch_cards
      SET punches         = v_punch_current - v_punch_target,
          total_completed = v_punch_card.total_completed + 1,
          updated_at      = NOW()
      WHERE gym_id = v_purchase.gym_id AND member_id = v_purchase.member_id AND product_id = v_purchase.product_id;

      -- The free item is itself recorded as an approved purchase (it's
      -- already granted, never queued).
      INSERT INTO member_purchases (gym_id, member_id, product_id, recorded_by, quantity, total_price, points_earned, is_free_reward, status, approved_by, approved_at)
      VALUES (v_purchase.gym_id, v_purchase.member_id, v_purchase.product_id, v_purchase.recorded_by, 1, 0, 0, TRUE, 'approved', auth.uid(), NOW())
      RETURNING id INTO v_free_purchase_id;

      v_punch_current := v_punch_current - v_punch_target;
    END IF;
  END IF;

  -- 2. Award reward points (same pattern as add_reward_points).
  IF v_points_earned > 0 THEN
    INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
    VALUES (v_purchase.member_id, v_purchase.gym_id, 'store_purchase', v_points_earned,
            'Store purchase: ' || v_purchase.quantity || 'x item', NOW());

    INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
    VALUES (v_purchase.member_id, v_purchase.gym_id, v_points_earned, v_points_earned, NOW())
    ON CONFLICT (profile_id) DO UPDATE SET
      total_points    = reward_points.total_points + v_points_earned,
      lifetime_points = reward_points.lifetime_points + v_points_earned,
      last_updated    = NOW();
  END IF;

  -- 3. Wallet pass push if the punch card changed.
  IF v_punch_changed THEN
    PERFORM public.notify_wallet_pass_update(
      v_purchase.member_id,
      CASE WHEN v_free_earned THEN 'free_reward_earned' ELSE 'punch_card_update' END
    );
  END IF;

  RETURN jsonb_build_object(
    'purchase_id',   v_purchase.id,
    'status',        'approved',
    'member_id',     v_purchase.member_id,
    'points_earned', v_points_earned,
    'punch_card_progress', CASE
      WHEN v_product_found AND v_product.punch_card_enabled THEN jsonb_build_object(
        'current_punches', v_punch_current,
        'target',          v_punch_target
      )
      ELSE NULL
    END,
    'free_item_earned', v_free_earned
  );
END;
$$;

-- ── 4. reject_gym_purchase — deny, grant nothing ─────────────
CREATE OR REPLACE FUNCTION public.reject_gym_purchase(
  p_purchase_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase RECORD;
BEGIN
  SELECT * INTO v_purchase
    FROM member_purchases
   WHERE id = p_purchase_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND gym_id = v_purchase.gym_id
      AND (
        role IN ('admin', 'super_admin')
        OR 'admin'::user_role       = ANY(additional_roles)
        OR 'super_admin'::user_role = ANY(additional_roles)
      )
  ) THEN
    RAISE EXCEPTION 'Only gym admins can reject purchases';
  END IF;

  -- Only a still-pending row can be rejected; anything else is a no-op.
  IF v_purchase.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'purchase_id',  v_purchase.id,
      'status',       v_purchase.status,
      'already_done', TRUE
    );
  END IF;

  UPDATE member_purchases
  SET status      = 'rejected',
      approved_by = auth.uid(),
      approved_at = NOW()
  WHERE id = v_purchase.id;

  RETURN jsonb_build_object(
    'purchase_id', v_purchase.id,
    'status',      'rejected'
  );
END;
$$;

-- ── 5. Grants ────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.approve_gym_purchase(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_gym_purchase(UUID)  TO authenticated;

NOTIFY pgrst, 'reload schema';
