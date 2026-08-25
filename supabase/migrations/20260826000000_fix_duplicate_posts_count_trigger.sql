-- forum_posts имел ДВА независимых триггера на INSERT, оба делавших ровно
-- одно и то же (posts_count = posts_count + 1, last_post_at, last_post_author_id):
--   forum_post_inserted   -> forum_after_post_insert()   (более старый/дублирующий)
--   on_forum_post_insert  -> update_thread_on_post()     (оставляем — ещё и updated_at)
-- Итог: каждый пост инкрементил forum_threads.posts_count дважды. Отсюда и
-- "10 ответов" на бейдже при 5 реальных постах, и разъехавшаяся постраничная
-- навигация (номер последней страницы считался по вдвое завышенному
-- количеству). Дубль — явно наследие миграционного бардака (см. корневой
-- CLAUDE.md "Migration history").

BEGIN;

DROP TRIGGER IF EXISTS forum_post_inserted ON forum_posts;
DROP FUNCTION IF EXISTS forum_after_post_insert();

-- Чиним уже испорченные счётчики — пересчитываем от реальных строк.
UPDATE forum_threads ft
SET posts_count = (SELECT count(*) FROM forum_posts fp WHERE fp.thread_id = ft.id);

COMMIT;
