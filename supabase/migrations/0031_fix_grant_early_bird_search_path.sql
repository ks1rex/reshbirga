-- Production bug fix: grant_early_bird() (0025_levels_achievements_categories.sql)
-- is SECURITY DEFINER with no explicit search_path and references `profiles`/
-- `achievements` unqualified. Depending on the caller's session search_path
-- (e.g. GoTrue's admin API connection), this trigger — fired AFTER INSERT ON
-- profiles as part of every new-user signup — can fail with
-- "relation \"profiles\" does not exist", aborting the whole signup transaction.
-- Fix: pin search_path and schema-qualify both tables, per Postgres's own
-- recommended practice for SECURITY DEFINER functions.

CREATE OR REPLACE FUNCTION public.grant_early_bird()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_at <= (SELECT MIN(created_at) FROM public.profiles) + interval '30 days' THEN
    INSERT INTO public.achievements (user_id, type) VALUES (NEW.id, 'early_bird')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
