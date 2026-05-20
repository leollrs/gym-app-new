-- =============================================================
-- 0418 — materialize_upcoming_print_card RPC
--
-- Lets an admin pre-create a print_cards row for an upcoming
-- milestone / tenure / habit / birthday BEFORE the daily cron
-- generates it. Use case:
--   • Owner sees a member's 100-workout card coming up in 3
--     sessions
--   • Owner pre-prints + pre-signs it now
--   • Card is waiting at the front desk on next visit
--
-- The daily cron's NOT EXISTS guard sees the pending row and
-- skips re-generation — no duplicates.
--
-- Headline / subline are passed from the client (taken from the
-- get_upcoming_print_cards prediction) so we don't have to mirror
-- the cron's template logic in this RPC.
-- =============================================================

CREATE OR REPLACE FUNCTION public.materialize_upcoming_print_card(
  p_gym_id        UUID,
  p_profile_id    UUID,
  p_occasion      card_occasion,
  p_headline      TEXT,
  p_subline       TEXT,
  p_occasion_data JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card_id UUID;
BEGIN
  -- Authorize: caller must be admin/super_admin/trainer of this gym
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = p_gym_id
      AND role IN ('admin', 'super_admin', 'trainer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Member must belong to this gym
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_profile_id AND gym_id = p_gym_id
  ) THEN
    RAISE EXCEPTION 'Member not found in this gym';
  END IF;

  -- Skip if there's already an active card for this occasion. Returning,
  -- delivered, dismissed, and expired rows don't block — those represent
  -- completed lifecycle of an earlier card or admin intent to skip.
  IF EXISTS (
    SELECT 1 FROM print_cards
    WHERE profile_id = p_profile_id
      AND occasion = p_occasion
      AND status IN ('pending', 'printed')
  ) THEN
    RAISE EXCEPTION 'Active card already exists for this member and occasion';
  END IF;

  -- 60-day expiry window. Long enough that an owner who pre-prints and
  -- then loses track has a comfortable cushion before the system marks
  -- it expired and recycles the slot.
  INSERT INTO print_cards (
    gym_id, profile_id, occasion, occasion_data,
    headline, subline, status, expires_at, created_at
  )
  VALUES (
    p_gym_id, p_profile_id, p_occasion, COALESCE(p_occasion_data, '{}'::jsonb),
    p_headline, p_subline, 'pending',
    NOW() + INTERVAL '60 days', NOW()
  )
  RETURNING id INTO v_card_id;

  RETURN v_card_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.materialize_upcoming_print_card(UUID, UUID, card_occasion, TEXT, TEXT, JSONB)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
