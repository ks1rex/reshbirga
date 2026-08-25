-- Картинка обложки темы + вложения (фото/файлы) у постов форума.
--
-- Формат attachments — тот же jsonb-массив { url, name, type }, что уже
-- используют listings.attachments (см. 20260809000000_listing_media.sql).
-- Файлы грузятся в тот же публичный бакет listing-media (уже разрешает
-- authenticated-запись в свою папку <uid>/... и публичное чтение) — под
-- форум отдельный бакет не нужен.

BEGIN;

ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS cover_url text;

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
