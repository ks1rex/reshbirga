-- Chat AI moderation (utils/aiChatCheck.js) only ever set ai_suspected —
-- unlike forum AI moderation (forum_moderation_log.ai_reason), it had no
-- column to record *why* DeepSeek flagged a message. Admins reviewing
-- /admin/chat-moderation could only see the flag, not the reasoning.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_reason text;
