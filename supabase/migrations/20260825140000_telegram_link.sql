-- Привязка личного Telegram к аккаунту — уведомления дублируются в бота,
-- которым уже пользуется админ (тот же TELEGRAM_BOT_TOKEN, отдельный бот
-- не нужен). Приём /start <код> идёт через вебхук (POST /telegram/webhook),
-- не long-polling — см. reshbirga/backend/src/routes/telegram.js.
BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS telegram_chat_id bigint,
  ADD COLUMN IF NOT EXISTS telegram_link_code text,
  ADD COLUMN IF NOT EXISTS telegram_link_code_expires_at timestamptz;

-- Один Telegram-чат — один аккаунт (защита от "подключил чужой чужому").
CREATE UNIQUE INDEX IF NOT EXISTS profiles_telegram_chat_id_key
  ON profiles (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

COMMIT;
