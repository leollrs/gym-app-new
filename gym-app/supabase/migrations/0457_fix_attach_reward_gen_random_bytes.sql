-- Fix: attach_reward_to_print_card failed with
--   "function gen_random_bytes(integer) does not exist"  (SQLSTATE 42883)
--
-- attach_reward_to_print_card (migration 0415) minted the earned-reward QR
-- code with `encode(gen_random_bytes(8), 'hex')`. gen_random_bytes() lives in
-- the pgcrypto extension, which on Supabase is installed in the `extensions`
-- schema — invisible under the function's `SET search_path = public`. So the
-- moment an owner attached a reward to a print card, the RPC raised 42883.
--
-- Same lesson as migration 0374 (get_or_create_conversation): gen_random_uuid()
-- IS available everywhere, gen_random_bytes() is not. We generate the code from
-- a UUID with the dashes stripped (32 hex chars, 128 bits) instead.
--
-- Recreated verbatim from 0415 except the v_qr_code assignment.

CREATE OR REPLACE FUNCTION public.attach_reward_to_print_card(
  p_card_id        UUID,
  p_reward_label   TEXT,
  p_reward_emoji   TEXT DEFAULT NULL,
  p_expires_in_days INT DEFAULT 30
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card       print_cards%ROWTYPE;
  v_caller_id  UUID;
  v_caller_role TEXT;
  v_reward_id  UUID;
  v_qr_code    TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only admins can attach rewards to print cards';
  END IF;

  SELECT * INTO v_card FROM print_cards WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found';
  END IF;

  -- Caller must belong to the same gym as the card
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller_id AND gym_id = v_card.gym_id
  ) THEN
    RAISE EXCEPTION 'Card belongs to a different gym';
  END IF;

  IF v_card.reward_id IS NOT NULL THEN
    RAISE EXCEPTION 'Card already has a reward attached';
  END IF;

  -- Create the earned reward (reuses the existing redemption pipeline).
  -- qr_code is the code the scanner uses (earned-reward:<code>). Built from a
  -- UUID (no dashes) — gen_random_uuid() works on every Supabase project,
  -- unlike pgcrypto's gen_random_bytes().
  v_qr_code := replace(gen_random_uuid()::text, '-', '');

  INSERT INTO earned_rewards (
    gym_id, profile_id, reward_label, reward_emoji,
    qr_code, source, status, expires_at
  )
  VALUES (
    v_card.gym_id, v_card.profile_id, p_reward_label, p_reward_emoji,
    v_qr_code, 'print_card', 'pending',
    NOW() + (p_expires_in_days || ' days')::INTERVAL
  )
  RETURNING id INTO v_reward_id;

  -- Link reward back onto the card + denormalize for print rendering
  UPDATE print_cards
     SET reward_id      = v_reward_id,
         reward_qr_code = v_qr_code,
         reward_label   = p_reward_label
   WHERE id = p_card_id;

  RETURN json_build_object(
    'success', true,
    'card_id', p_card_id,
    'reward_id', v_reward_id,
    'qr_code', v_qr_code,
    'expires_at', NOW() + (p_expires_in_days || ' days')::INTERVAL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_reward_to_print_card(UUID, TEXT, TEXT, INT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
