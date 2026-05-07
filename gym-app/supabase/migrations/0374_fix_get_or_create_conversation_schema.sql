-- ============================================================
-- 0374 — Fix get_or_create_conversation: use the real schema
-- ============================================================
-- Migration 0355 redefined get_or_create_conversation to read from
-- and INSERT into a `conversation_participants` table — but that
-- table was never created in any prior migration. The actual
-- conversations schema (live since 0338) keeps both participants
-- on the row itself via participant_1 / participant_2 columns.
--
-- Since the 0355 redefinition shipped, every call to the RPC has
-- failed with:
--   42P01: relation "conversation_participants" does not exist
-- → Admin "New Message" picker can't actually open a thread.
--
-- This migration restores the body to operate on the real columns
-- while preserving everything else 0355 added: the block guard,
-- the same-gym requirement, and the role-based DM gating
-- (members can only DM friends/staff, trainers can only DM
-- assigned clients or staff, admins can DM anyone in their gym).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other_user UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_caller_gym  UUID;
  v_caller_role TEXT;
  v_other_gym   UUID;
  v_other_role  TEXT;
  v_convo_id    UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_caller_id = p_other_user THEN
    RAISE EXCEPTION 'Cannot DM yourself';
  END IF;

  -- Block enforcement (preserved from 0338/0355).
  IF EXISTS (
    SELECT 1 FROM public.is_blocked_pair(v_caller_id, p_other_user) WHERE is_blocked_pair = TRUE
  ) THEN
    RAISE EXCEPTION 'Conversation blocked';
  END IF;

  SELECT gym_id, role::TEXT INTO v_caller_gym, v_caller_role
    FROM public.profile_lookup WHERE id = v_caller_id;
  SELECT gym_id, role::TEXT INTO v_other_gym, v_other_role
    FROM public.profile_lookup WHERE id = p_other_user;

  IF v_caller_gym IS NULL OR v_other_gym IS NULL OR v_caller_gym <> v_other_gym THEN
    RAISE EXCEPTION 'Cannot DM users outside your gym';
  END IF;

  -- Role-based gating (admins are unrestricted).
  IF v_caller_role = 'member' THEN
    IF v_other_role NOT IN ('trainer', 'admin', 'super_admin') THEN
      IF NOT EXISTS (
        SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND ((requester_id = v_caller_id AND addressee_id = p_other_user)
            OR (requester_id = p_other_user AND addressee_id = v_caller_id))
      ) THEN
        RAISE EXCEPTION 'Members can only DM friends, trainers, or admins';
      END IF;
    END IF;
  ELSIF v_caller_role = 'trainer' THEN
    IF v_other_role = 'member' THEN
      IF NOT EXISTS (
        SELECT 1 FROM trainer_clients
        WHERE trainer_id = v_caller_id AND client_id = p_other_user AND is_active = TRUE
      ) THEN
        RAISE EXCEPTION 'Trainers can only DM assigned clients';
      END IF;
    END IF;
  END IF;

  -- Find existing conversation (either ordering) using the real schema.
  SELECT id INTO v_convo_id FROM conversations
  WHERE (participant_1 = v_caller_id AND participant_2 = p_other_user)
     OR (participant_1 = p_other_user AND participant_2 = v_caller_id)
  LIMIT 1;

  IF v_convo_id IS NOT NULL THEN
    RETURN v_convo_id;
  END IF;

  -- Don't generate the encryption_seed inline. pgcrypto's gen_random_bytes()
  -- isn't enabled on every Supabase project (we hit 42883 in production).
  -- conversations.encryption_seed has DEFAULT gen_random_uuid()::text from
  -- migration 0228, which IS available everywhere — let the column default
  -- fire instead.
  INSERT INTO conversations (gym_id, participant_1, participant_2)
  VALUES (v_caller_gym, v_caller_id, p_other_user)
  RETURNING id INTO v_convo_id;

  RETURN v_convo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
