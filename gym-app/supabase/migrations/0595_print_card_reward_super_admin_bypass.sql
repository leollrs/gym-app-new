-- Fix: platform super-admins couldn't attach/detach rewards on cross-gym print
-- cards from the Card Queue (`/platform/card-queue`).
--
-- attach_reward_to_print_card / detach_reward_from_print_card (last recreated in
-- 0457 / 0415) allow role IN ('admin','super_admin'), but then unconditionally
-- require the caller's OWN profiles.gym_id to equal the card's gym:
--
--   IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_caller_id AND gym_id = v_card.gym_id) THEN
--     RAISE EXCEPTION 'Card belongs to a different gym';
--   END IF;
--
-- A platform super-admin has no per-gym profile row matching every gym, so the
-- super_admin role grant is meaningless here — they always hit 'Card belongs to
-- a different gym'. The cross-gym super_admin RLS (0430) already lets them read
-- the print_cards rows, so the queue lists the cards but the reward action 422s.
--
-- This migration CREATE OR REPLACEs BOTH functions, replicating their bodies
-- VERBATIM from 0457 (attach) / 0415 (detach) except the same-gym ownership
-- check is now skipped when public.is_super_admin() is true. Everyone else
-- (gym admins) is still locked to their own gym exactly as before. Grants,
-- SECURITY DEFINER, and search_path are unchanged. Idempotent.

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

  -- Caller must belong to the same gym as the card — EXCEPT platform
  -- super-admins, who operate across every gym (Card Queue). 0430 already
  -- grants them cross-gym read; this lets them attach the reward too.
  IF NOT public.is_super_admin() AND NOT EXISTS (
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

CREATE OR REPLACE FUNCTION public.detach_reward_from_print_card(p_card_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card       print_cards%ROWTYPE;
  v_caller_id  UUID;
  v_caller_role TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only admins can modify print cards';
  END IF;

  SELECT * INTO v_card FROM print_cards WHERE id = p_card_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found';
  END IF;

  -- Same-gym guard, bypassed for platform super-admins (see attach above).
  IF NOT public.is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller_id AND gym_id = v_card.gym_id
  ) THEN
    RAISE EXCEPTION 'Card belongs to a different gym';
  END IF;

  -- Cancel the earned reward if it's still pending (don't yank a
  -- reward the member already redeemed)
  IF v_card.reward_id IS NOT NULL THEN
    UPDATE earned_rewards
       SET status = 'cancelled'
     WHERE id = v_card.reward_id AND status = 'pending';
  END IF;

  UPDATE print_cards
     SET reward_id      = NULL,
         reward_qr_code = NULL,
         reward_label   = NULL
   WHERE id = p_card_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.detach_reward_from_print_card(UUID)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
