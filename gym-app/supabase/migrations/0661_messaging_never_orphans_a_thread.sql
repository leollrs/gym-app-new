-- ============================================================
-- 0661 — Messaging: an existing thread can never be gated shut
-- ============================================================
-- Two defects, both surfaced by testing the consent work:
--
-- 1. THE GATE RAN BEFORE THE LOOKUP. get_or_create_conversation decided
--    permission and only then looked for an existing conversation, so the rules
--    for STARTING a thread were applied to one that already existed. When a
--    coaching relationship ended, the trainer lost access to the history —
--    while the ex-client could still message them, because "anyone may DM gym
--    staff" is unconditional. A thread that works one way and not the other is
--    not a policy.
--
-- 2. THE TRAINER BRANCH REQUIRED A LIVE, ACCEPTED LINK. 0660 tightened it to
--    `is_active AND status = 'active'`, which is right for DATA but wrong for
--    conversation: people stop training together and the messages are still
--    theirs. A trainer may now DM anyone they have ever coached.
--
-- What still blocks a conversation: an explicit block. is_blocked_pair is
-- checked ahead of everything here and is untouched.
--
-- The body below is 0660's, with the trainer predicate relaxed and the existing
-- lookup MOVED (not rewritten) above the gate — so the query itself is
-- byte-identical to the one that has always run.
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

  -- AN EXISTING CONVERSATION IS NEVER RE-GATED. This lookup used to sit AFTER
  -- the gate below, so a relationship ending took the history with it: a trainer
  -- could not reopen a thread with a past client, while that same client could
  -- still write to them (staff are always reachable). One direction of an
  -- existing thread going dead is not a rule, it's a bug.
  --
  -- The gate still decides who may START one. Explicit blocks are unaffected —
  -- is_blocked_pair is checked above this point and remains the only thing that
  -- can cut a conversation off.
  -- Find existing conversation (either ordering) using the real schema.
  SELECT id INTO v_convo_id FROM conversations
  WHERE (participant_1 = v_caller_id AND participant_2 = p_other_user)
     OR (participant_1 = p_other_user AND participant_2 = v_caller_id)
  LIMIT 1;

  IF v_convo_id IS NOT NULL THEN
    RETURN v_convo_id;
  END IF;

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
      WHERE trainer_id = v_caller_id AND client_id = p_other_user
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

REVOKE ALL ON FUNCTION public.get_or_create_conversation(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
