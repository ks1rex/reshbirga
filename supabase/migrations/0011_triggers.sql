-- Auto-create profile on user registration
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, nickname)
  VALUES (
    NEW.id,
    'user_' || LOWER(LEFT(REPLACE(NEW.id::text, '-', ''), 6))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Recalculate profile ratings when a review is inserted
CREATE OR REPLACE FUNCTION update_profile_ratings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NEW.context = 'as_customer' THEN
    UPDATE profiles SET
      rating_as_customer = (
        SELECT ROUND(AVG(rating)::numeric, 2)
        FROM reviews WHERE reviewee_id = NEW.reviewee_id AND context = 'as_customer'
      ),
      reviews_count_customer = (
        SELECT COUNT(*) FROM reviews
        WHERE reviewee_id = NEW.reviewee_id AND context = 'as_customer'
      )
    WHERE id = NEW.reviewee_id;
  ELSE
    UPDATE profiles SET
      rating_as_executor = (
        SELECT ROUND(AVG(rating)::numeric, 2)
        FROM reviews WHERE reviewee_id = NEW.reviewee_id AND context = 'as_executor'
      ),
      reviews_count_executor = (
        SELECT COUNT(*) FROM reviews
        WHERE reviewee_id = NEW.reviewee_id AND context = 'as_executor'
      )
    WHERE id = NEW.reviewee_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_review_inserted
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_profile_ratings();
