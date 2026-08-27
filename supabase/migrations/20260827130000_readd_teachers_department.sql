-- Кафедра возвращается: изначально убрали из-за отсутствия надёжного
-- источника, теперь есть официальный парсинг с lk.gubkin.ru
-- (getDivisions + getActiveTeachersByDivisionId), см. C:\schedule-fetcher\teachers.js.
BEGIN;

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS department text;

COMMIT;
