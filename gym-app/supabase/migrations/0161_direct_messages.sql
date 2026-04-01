-- Conversations between two users
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    participant_1 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    participant_2 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    last_message_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(participant_1, participant_2)
);

-- Messages
CREATE TABLE IF NOT EXISTS direct_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(body) <= 2000),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_conversations_participants ON conversations(participant_1, participant_2);
CREATE INDEX idx_conversations_p1 ON conversations(participant_1, last_message_at DESC);
CREATE INDEX idx_conversations_p2 ON conversations(participant_2, last_message_at DESC);
CREATE INDEX idx_messages_conversation ON direct_messages(conversation_id, created_at);
CREATE INDEX idx_messages_unread ON direct_messages(conversation_id, sender_id) WHERE read_at IS NULL;

-- RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

-- Users can see conversations they're part of
CREATE POLICY "conversations_select" ON conversations FOR SELECT
  USING (participant_1 = auth.uid() OR participant_2 = auth.uid());
CREATE POLICY "conversations_insert" ON conversations FOR INSERT
  WITH CHECK (participant_1 = auth.uid() OR participant_2 = auth.uid());
CREATE POLICY "conversations_update" ON conversations FOR UPDATE
  USING (participant_1 = auth.uid() OR participant_2 = auth.uid());

-- Users can see/send messages in their conversations
CREATE POLICY "messages_select" ON direct_messages FOR SELECT
  USING (conversation_id IN (SELECT id FROM conversations WHERE participant_1 = auth.uid() OR participant_2 = auth.uid()));
CREATE POLICY "messages_insert" ON direct_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND conversation_id IN (SELECT id FROM conversations WHERE participant_1 = auth.uid() OR participant_2 = auth.uid()));
CREATE POLICY "messages_update" ON direct_messages FOR UPDATE
  USING (conversation_id IN (SELECT id FROM conversations WHERE participant_1 = auth.uid() OR participant_2 = auth.uid()));

-- RPC: Get or create a conversation with another user
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

GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(UUID) TO authenticated;
