-- Сайтовые уведомления (колокольчик рядом с аватаркой): "вас выбрали
-- исполнителем", "купили вашу услугу", пополнения/выводы, споры, отзывы и
-- т.д. Пишет только service-role бэкенд (routes/*.js через utils/notify.js),
-- поэтому INSERT-политики для authenticated нет — вставка по умолчанию
-- запрещена, сервисный клиент RLS не подчиняется. Читает и помечает
-- прочитанным тоже только бэкенд (GET/PATCH /notifications), см. CLAUDE.md
-- "DB write restrictions" — авторизация живёт в Express, а не в RLS.
-- SELECT-политика нужна отдельно: Realtime-подписка на бирже (мгновенное
-- обновление колокольчика) идёт напрямую из браузера через anon-ключ и
-- сверяется с RLS, а не с бэкендом.
BEGIN;

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_id_created_at_idx ON notifications (user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ebu_notifications_select_own" ON notifications
  FOR SELECT USING (user_id = auth.uid());

-- Как и messages — без этого postgres_changes-подписка в браузере (колокольчик
-- обновляется без перезагрузки) молчит, RLS тут ни при чём.
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

COMMIT;
