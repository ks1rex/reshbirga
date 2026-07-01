-- Add moderation_reviewed to messages (is_contact_info already exists from 0006)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS moderation_reviewed boolean NOT NULL DEFAULT false;

-- Index for fast admin moderation queries
CREATE INDEX IF NOT EXISTS idx_messages_contact_info ON messages(is_contact_info, moderation_reviewed);

-- Storage bucket for chat attachments (private, 10 MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- Enable realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Trigger function: auto-create conversation when executor is first assigned
CREATE OR REPLACE FUNCTION handle_executor_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  conv_id uuid;
BEGIN
  IF OLD.executor_id IS NULL AND NEW.executor_id IS NOT NULL THEN
    INSERT INTO conversations (type, order_id)
    VALUES ('order_chat', NEW.id)
    RETURNING id INTO conv_id;

    INSERT INTO conversation_participants (conversation_id, user_id, role)
    VALUES
      (conv_id, NEW.customer_id, 'customer'),
      (conv_id, NEW.executor_id, 'executor');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_executor_assigned ON orders;
CREATE TRIGGER on_executor_assigned
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_executor_assigned();
