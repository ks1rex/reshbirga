-- Add AI moderation columns to messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_suspected   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_checked_at  timestamptz          DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_ai_suspected ON messages(ai_suspected) WHERE ai_suspected = true;
