-- ============================================================
-- 0536 — get_or_create_conversation: honour additional_roles
--        (+ column-level UPDATE hardening on direct_messages)
-- ============================================================
-- P2-16 (trainer audit 2026-06-11): the role gating in
-- get_or_create_conversation (last defined in 0374) reads ONLY the
-- PRIMARY role from profile_lookup. The multi-role model (0332) keeps
-- extra roles in additional_roles (user_role[]; mirrored into
-- profile_lookup since 0465), and the public trainer directory RPC
-- (0391) lists multi-role trainers — so a member tapping "Message" on
-- a trainer whose primary role is 'member' (trainer only in
-- additional_roles) got:
--   "Members can only DM friends, trainers, or admins"
--
-- Fix: every role check now considers the EFFECTIVE role set
-- (role = X OR X = ANY(additional_roles)) on both sides:
--   • other side "is staff"  → trainer/admin/super_admin in either slot
--   • caller "is admin"      → unrestricted (as before)
--   • caller "is trainer"    → may DM assigned clients + staff
--   • everyone               → may DM accepted friends (the member path;
--     note 0332 appends 'member' to every staff profile's
--     additional_roles, so staff legitimately keep their personal
--     friend DMs — previously a primary-role trainer could NOT DM a
--     mutual friend, which the effective-role model deliberately fixes)
--
-- Preserved verbatim from 0374: auth/self checks, is_blocked_pair
-- block enforcement, same-gym requirement, find-existing in either
-- participant order, and seed generation via the column DEFAULT
-- (pgcrypto's gen_random_bytes is not enabled on every project).
-- Error message strings are unchanged — the clients string-match them
-- (TrainerMessages.jsx handleNewConversation, member Messages.jsx).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other_user UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_caller_gym     UUID;
  v_caller_role    TEXT;
  v_caller_extra   public.user_role[];
  v_other_gym      UUID;
  v_other_role     TEXT;
  v_other_extra    public.user_role[];
  v_caller_is_admin   BOOLEAN;
  v_caller_is_trainer BOOLEAN;
  v_other_is_staff    BOOLEAN;
  v_allowed        BOOLEAN := FALSE;
  v_convo_id       UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_caller_id = p_other_user THEN
    RAISE EXCEPTION 'Cannot DM yourself';
  END IF;

  -- Block enforcement (preserved from 0338/0355/0374).
  IF EXISTS (
    SELECT 1 FROM public.is_blocked_pair(v_caller_id, p_other_user) WHERE is_blocked_pair = TRUE
  ) THEN
    RAISE EXCEPTION 'Conversation blocked';
  END IF;

  SELECT gym_id, role::TEXT, COALESCE(additional_roles, '{}'::public.user_role[])
    INTO v_caller_gym, v_caller_role, v_caller_extra
    FROM public.profile_lookup WHERE id = v_caller_id;
  SELECT gym_id, role::TEXT, COALESCE(additional_roles, '{}'::public.user_role[])
    INTO v_other_gym, v_other_role, v_other_extra
    FROM public.profile_lookup WHERE id = p_other_user;

  IF v_caller_gym IS NULL OR v_other_gym IS NULL OR v_caller_gym <> v_other_gym THEN
    RAISE EXCEPTION 'Cannot DM users outside your gym';
  END IF;

  -- Effective-role flags (primary role OR additional_roles).
  v_caller_is_admin :=
       v_caller_role IN ('admin', 'super_admin')
    OR v_caller_extra && ARRAY['admin', 'super_admin']::public.user_role[];
  v_caller_is_trainer :=
       v_caller_role = 'trainer'
    OR 'trainer'::public.user_role = ANY(v_caller_extra);
  v_other_is_staff :=
       v_other_role IN ('trainer', 'admin', 'super_admin')
    OR v_other_extra && ARRAY['trainer', 'admin', 'super_admin']::public.user_role[];

  -- Gating: a conversation is allowed if ANY of the caller's effective
  -- roles permits it.
  IF v_caller_is_admin THEN
    v_allowed := TRUE;                       -- admins are unrestricted
  END IF;

  IF NOT v_allowed AND v_other_is_staff THEN
    v_allowed := TRUE;                       -- anyone may DM gym staff
  END IF;

  IF NOT v_allowed AND v_caller_is_trainer THEN
    IF EXISTS (
      SELECT 1 FROM trainer_clients
      WHERE trainer_id = v_caller_id AND client_id = p_other_user AND is_active = TRUE
    ) THEN
      v_allowed := TRUE;                     -- trainer → assigned client
    END IF;
  END IF;

  IF NOT v_allowed THEN
    IF EXISTS (
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND ((requester_id = v_caller_id AND addressee_id = p_other_user)
          OR (requester_id = p_other_user AND addressee_id = v_caller_id))
    ) THEN
      v_allowed := TRUE;                     -- accepted friends
    END IF;
  END IF;

  IF NOT v_allowed THEN
    IF v_caller_is_trainer THEN
      RAISE EXCEPTION 'Trainers can only DM assigned clients';
    ELSE
      RAISE EXCEPTION 'Members can only DM friends, trainers, or admins';
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

-- ============================================================
-- Hardening: column-level UPDATE grant on direct_messages
-- ============================================================
-- The messages_update RLS policy (0222) lets EITHER participant UPDATE
-- any column of any row in their conversation — including the message
-- BODY — via the raw REST API. Repo-wide audit (2026-06-11): the only
-- client-side direct_messages UPDATE ever issued sets read_at
-- (TrainerMessages.jsx ×2, admin DirectMessagesTab.jsx ×2; member
-- Messages.jsx goes through the mark_conversation_read RPC, which is
-- SECURITY DEFINER and unaffected). No edge function touches
-- direct_messages, and service_role keeps its own full grant.
-- → Narrow the authenticated grant to UPDATE(read_at) only, closing
--   the "either participant can rewrite message history" hole without
--   touching the RLS policy.
REVOKE UPDATE ON public.direct_messages FROM authenticated;
GRANT UPDATE (read_at) ON public.direct_messages TO authenticated;
-- anon has no business writing messages at all (RLS already blocks it;
-- drop the table privilege too).
REVOKE UPDATE ON public.direct_messages FROM anon;

NOTIFY pgrst, 'reload schema';
