-- Поле "кафедра" убрано из карточки преподавателя по решению продукта —
-- ни на публичной странице, ни в админке оно больше не используется.
BEGIN;

ALTER TABLE teachers DROP COLUMN IF EXISTS department;

COMMIT;
