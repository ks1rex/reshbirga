-- ВНИМАНИЕ: НЕ ПРИМЕНЯТЬ. Этот файл не отражает реальное состояние живой БД
-- (btcpbvevytmhgkevhnyj) — см. docs/AUDIT_MIGRATION_SAFETY_2026.md за построчным
-- разбором безопасности и docs/AUDIT_MIGRATION_DRIFT_2026.md за объяснением,
-- почему локальная нумерация 0001-0036 разошлась с реальной историей.
-- Реальная схема применена под timestamp-версиями миграций, не под этим именем.

-- Add AI moderation columns to messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_suspected   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_checked_at  timestamptz          DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_ai_suspected ON messages(ai_suspected) WHERE ai_suspected = true;
