-- Медиа у услуг: обложка на карточке каталога + вложения (фото/файлы).
--
-- Хранилище повторяет схему аватарок (bucket `avatars`): публичное чтение,
-- запись только в свою папку `<uid>/...`. Публичность здесь осознанная —
-- обложка показывается в каталоге всем, включая незалогиненных, а подписанные
-- ссылки для витрины пришлось бы перевыпускать на каждый запрос списка.
--
-- Сами вложения лежат json-массивом в самой строке услуги, отдельной таблицы
-- нет: их единицы, они всегда читаются вместе с услугой и ни с чем не
-- соединяются. Формат элемента: { url, name, type }.

BEGIN;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-media', 'listing-media', true, 10485760,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Читать может кто угодно (витрина), писать/менять/удалять — только владелец
-- своей папки. Ровно то же, что у `ebu_avatars_*`, плюс DELETE: обложку меняют
-- чаще аватарки, и старый файл должен уходить из хранилища, а не копиться.
DROP POLICY IF EXISTS "ebu_listing_media_select" ON storage.objects;
CREATE POLICY "ebu_listing_media_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'listing-media');

DROP POLICY IF EXISTS "ebu_listing_media_insert" ON storage.objects;
CREATE POLICY "ebu_listing_media_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-media' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "ebu_listing_media_update" ON storage.objects;
CREATE POLICY "ebu_listing_media_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'listing-media' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'listing-media' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "ebu_listing_media_delete" ON storage.objects;
CREATE POLICY "ebu_listing_media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'listing-media' AND (auth.uid())::text = (storage.foldername(name))[1]);

COMMIT;
