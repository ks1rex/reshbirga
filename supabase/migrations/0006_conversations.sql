CREATE TABLE conversations (
  id         uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  type       conversation_type NOT NULL,
  order_id   uuid              REFERENCES orders(id) ON DELETE SET NULL,
  created_at timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_order ON conversations(order_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE conversation_participants (
  id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid             NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid             NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role            participant_role NOT NULL,
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_participants_conversation ON conversation_participants(conversation_id);
CREATE INDEX idx_participants_user         ON conversation_participants(user_id);

ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE TABLE messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  content         text        NOT NULL,
  is_contact_info boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_created      ON messages(created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE message_attachments (
  id         uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid   NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_path  text   NOT NULL,
  file_name  text   NOT NULL,
  file_size  bigint NOT NULL
);

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

-- Security definer to avoid recursion when checking participation
CREATE OR REPLACE FUNCTION is_conversation_participant(conv_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = conv_id AND user_id = auth.uid()
  )
$$;

-- Conversations: participants + admin
CREATE POLICY "conversations_select"
  ON conversations FOR SELECT TO authenticated
  USING (is_conversation_participant(id) OR is_admin());

-- Participants record: participants + admin
CREATE POLICY "participants_select"
  ON conversation_participants FOR SELECT TO authenticated
  USING (is_conversation_participant(conversation_id) OR is_admin());

-- Messages: participants + admin
CREATE POLICY "messages_select"
  ON messages FOR SELECT TO authenticated
  USING (is_conversation_participant(conversation_id) OR is_admin());

-- Only participants can send messages (sender_id must be self)
CREATE POLICY "messages_insert"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND is_conversation_participant(conversation_id)
  );

-- Message attachments: read if can read the message's conversation
CREATE POLICY "message_attachments_select"
  ON message_attachments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_id
        AND (is_conversation_participant(m.conversation_id) OR is_admin())
    )
  );

-- Upload attachment only for own messages
CREATE POLICY "message_attachments_insert"
  ON message_attachments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_id AND m.sender_id = auth.uid()
    )
  );
