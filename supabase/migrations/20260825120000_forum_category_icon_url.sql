-- Кастомная картинка иконки категории форума — альтернатива icon_name
-- (эмодзи). Загрузка идёт только через service-role бэкенд (POST
-- /admin/forum/categories/:id/icon), поэтому RLS-политики на запись не
-- нужны: анон/authenticated получают отказ по умолчанию, а публичность
-- бакета нужна только для чтения (витрина форума открыта всем).
BEGIN;

ALTER TABLE forum_categories
  ADD COLUMN IF NOT EXISTS icon_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'forum-icons', 'forum-icons', true, 2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
