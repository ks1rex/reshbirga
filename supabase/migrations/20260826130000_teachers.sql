-- Преподаватели университета + отзывы/рейтинг от студентов.
-- Список преподавателей пока наполняется вручную через админку
-- (POST/PATCH/DELETE /teachers) — парсинг с сайта губкинского университета
-- планируется отдельной задачей позже, эта таблица уже готова его принять.
-- Отзыв — один на пару (преподаватель, пользователь), можно отредактировать
-- (upsert через POST /teachers/:id/reviews), как отзывы на бирже.
BEGIN;

CREATE TABLE teachers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  department text,
  position   text,
  photo_url  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teacher_reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, user_id)
);

CREATE INDEX teacher_reviews_teacher_id_idx ON teacher_reviews (teacher_id);

-- Агрегаты рейтинга считаем через view, а не денормализованными столбцами —
-- проще и надёжнее при удалении/редактировании отзыва.
CREATE VIEW teacher_stats AS
  SELECT teacher_id, avg(rating)::numeric(3,2) AS avg_rating, count(*) AS reviews_count
  FROM teacher_reviews
  GROUP BY teacher_id;

ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_reviews ENABLE ROW LEVEL SECURITY;

COMMIT;
