-- Security fix: prevent cross-gym messaging and add DELETE policies
-- 1. Redefine get_or_create_conversation with gym check on target user
-- 2. Add missing DELETE policies on conversations and direct_messages

-- 1. Redefine function with gym validation
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other_user UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  my_gym UUID;
  v_conv_id UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NULL; END IF;
  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  -- Verify target user is in the same gym
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_other_user AND gym_id = my_gym) THEN
    RAISE EXCEPTION 'Cannot message users outside your gym';
  END IF;

  -- Check existing (either direction)
  SELECT id INTO v_conv_id FROM conversations
  WHERE (participant_1 = uid AND participant_2 = p_other_user)
     OR (participant_1 = p_other_user AND participant_2 = uid)
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN RETURN v_conv_id; END IF;

  -- Create new
  INSERT INTO conversations (gym_id, participant_1, participant_2)
  VALUES (my_gym, uid, p_other_user)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;

-- 2. Add DELETE policies
CREATE POLICY "conversations_delete" ON conversations FOR DELETE
  USING (participant_1 = auth.uid() OR participant_2 = auth.uid());

CREATE POLICY "messages_delete" ON direct_messages FOR DELETE
  USING (conversation_id IN (
    SELECT id FROM conversations
    WHERE participant_1 = auth.uid() OR participant_2 = auth.uid()
  ));
