-- =============================================================
-- APPLE WALLET PASS PUSH UPDATES
-- Migration: 0085_wallet_pass_push_updates.sql
--
-- Stores device registrations for Apple Wallet passes so we can
-- push updates when punch card progress changes. Also adds a
-- stable serial number to profiles for consistent pass identity.
-- =============================================================

-- ── 1. Stable pass serial per member ────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS wallet_pass_serial TEXT,
  ADD COLUMN IF NOT EXISTS wallet_auth_token  TEXT;

-- Generate default values for existing rows
UPDATE profiles
SET wallet_pass_serial = 'pass-' || id::text,
    wallet_auth_token  = encode(gen_random_bytes(32), 'hex')
WHERE wallet_pass_serial IS NULL;

-- Auto-generate for new rows
ALTER TABLE profiles
  ALTER COLUMN wallet_pass_serial SET DEFAULT 'pass-' || gen_random_uuid()::text;

-- ── 2. wallet_pass_registrations — Device ↔ Pass mapping ────

CREATE TABLE IF NOT EXISTS wallet_pass_registrations (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_library_identifier   TEXT NOT NULL,
    push_token                  TEXT NOT NULL,
    pass_type_identifier        TEXT NOT NULL,
    serial_number               TEXT NOT NULL,
    profile_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id                      UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(device_library_identifier, pass_type_identifier, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_wallet_reg_serial
  ON wallet_pass_registrations(pass_type_identifier, serial_number);

CREATE INDEX IF NOT EXISTS idx_wallet_reg_device
  ON wallet_pass_registrations(device_library_identifier, pass_type_identifier);

CREATE INDEX IF NOT EXISTS idx_wallet_reg_profile
  ON wallet_pass_registrations(profile_id);

-- No RLS needed — accessed only by edge functions via service role key

-- ── 3. wallet_pass_update_log — Track when passes were updated ─

CREATE TABLE IF NOT EXISTS wallet_pass_update_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reason          TEXT NOT NULL,
    push_sent       BOOLEAN NOT NULL DEFAULT FALSE,
    devices_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_update_log_profile
  ON wallet_pass_update_log(profile_id, created_at DESC);

-- ── 4. RPC to queue wallet push after punch card changes ────

CREATE OR REPLACE FUNCTION public.notify_wallet_pass_update(
  p_profile_id UUID,
  p_reason     TEXT DEFAULT 'punch_card_update'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log the update request (the actual push is handled by edge function polling or webhook)
  INSERT INTO wallet_pass_update_log (profile_id, reason)
  VALUES (p_profile_id, p_reason);

  -- Use pg_notify so a listener (or cron) can trigger the push
  PERFORM pg_notify('wallet_pass_update', json_build_object(
    'profile_id', p_profile_id,
    'reason', p_reason
  )::text);
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_wallet_pass_update(UUID, TEXT) TO authenticated;

-- ── 5. Update record_gym_purchase to trigger wallet push ────

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

-- ── 6. Trigger function: call push-wallet-update edge function ─
-- Uses pg_net (Supabase HTTP extension) to call the edge function
-- after a wallet_pass_update_log insert. This fires asynchronously.

CREATE OR REPLACE FUNCTION public.trigger_wallet_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key  TEXT;
BEGIN
  -- Read from vault or use the known project URL
  -- pg_net makes an async HTTP call so this won't block the transaction
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  -- If vault isn't set up, skip silently
  IF v_service_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_supabase_url
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_url'
  LIMIT 1;

  IF v_supabase_url IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fire async HTTP request to push-wallet-update edge function
  PERFORM net.http_post(
    url     := v_supabase_url || '/functions/v1/push-wallet-update',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'profileId', NEW.profile_id,
      'reason', NEW.reason
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Don't let push failures break the purchase flow
    RAISE WARNING 'wallet push trigger failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Only create the trigger if pg_net extension is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    DROP TRIGGER IF EXISTS trg_wallet_push ON wallet_pass_update_log;
    CREATE TRIGGER trg_wallet_push
      AFTER INSERT ON wallet_pass_update_log
      FOR EACH ROW
      EXECUTE FUNCTION public.trigger_wallet_push();
  ELSE
    RAISE NOTICE 'pg_net extension not available — wallet push trigger not created. Push updates will rely on manual invocation.';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
