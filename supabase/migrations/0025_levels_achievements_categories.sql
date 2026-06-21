-- Extended profile, achievements, market categories, gamification counters.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio                text,
  ADD COLUMN IF NOT EXISTS is_verified         boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS skills              text[],
  ADD COLUMN IF NOT EXISTS level               integer       NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reputation          integer       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forum_posts_count   integer       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deals_count         integer       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_rating      numeric(3,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviews_count       integer       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gost_uses           integer       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_topup_total  numeric(12,2) NOT NULL DEFAULT 0;

-- One-off view-milestone reputation bonuses for the thread author — flags
-- prevent re-granting on every subsequent /threads/:id/view call.
ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS rep_bonus_50_given  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rep_bonus_200_given boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS achievements (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid REFERENCES profiles(id) ON DELETE CASCADE,
  type      text NOT NULL,
  earned_at timestamptz DEFAULT now(),
  UNIQUE(user_id, type)
);
CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);

ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "achievements_public_read" ON achievements FOR SELECT USING (true);

-- Market categories (orders = "заказы", listings = "услуги" — the two sides of the
-- exchange referred to as market_orders/market_services in the spec).
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS category text;

CREATE TABLE IF NOT EXISTS market_categories (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  icon       text,
  sort_order integer NOT NULL DEFAULT 0
);

INSERT INTO market_categories (id, name, icon, sort_order) VALUES
  ('study', 'Учёба и сессия',     'BookOpen',        1),
  ('design', 'Дизайн',            'Palette',         2),
  ('code', 'Программирование',    'Code2',           3),
  ('text', 'Тексты и переводы',   'FileText',        4),
  ('photo', 'Фото и видео',       'Camera',          5),
  ('other', 'Другое',             'MoreHorizontal',  6)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE market_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_categories_public_read" ON market_categories FOR SELECT USING (true);

-- Keep the unified average_rating/reviews_count in sync with the existing
-- per-role rating trigger (update_profile_ratings, 0011_triggers.sql) so both
-- the legacy split ratings and the new combined profile fields stay correct.
CREATE OR REPLACE FUNCTION update_profile_average_rating()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles SET
    average_rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE reviewee_id = NEW.reviewee_id),
    reviews_count  = (SELECT COUNT(*) FROM reviews WHERE reviewee_id = NEW.reviewee_id)
  WHERE id = NEW.reviewee_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_review_inserted_average
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_profile_average_rating();

-- early_bird achievement: registered within 30 days of the very first account
-- (a stand-in for "site launch" — no separate launch-date config to maintain).
CREATE OR REPLACE FUNCTION grant_early_bird()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NEW.created_at <= (SELECT MIN(created_at) FROM profiles) + interval '30 days' THEN
    INSERT INTO achievements (user_id, type) VALUES (NEW.id, 'early_bird')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created_early_bird
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION grant_early_bird();
