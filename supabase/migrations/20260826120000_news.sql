-- Новости платформы: пишет только админ (POST/PATCH/DELETE /news через
-- Express, service-role), читают все авторизованные пользователи через
-- GET /news — RLS тут не нужен для чтения (доступ через бэкенд), но включаем
-- его по умолчанному правилу репозитория ("новая таблица — RLS on, без
-- policy для authenticated/anon, service-role её не спрашивает").
BEGIN;

CREATE TABLE news (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  content    text NOT NULL,
  author_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX news_created_at_idx ON news (created_at DESC);

ALTER TABLE news ENABLE ROW LEVEL SECURITY;

COMMIT;
