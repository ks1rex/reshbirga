-- Referral program: fields on profiles + deposit_requests + updated trigger.
--
-- Each new user gets a unique referral_code (8-char hex from their UUID).
-- referred_by links them to the referrer who invited them.
-- referral_earnings tracks lifetime bonus received.
-- referral_registered_count tracks how many people registered via this user's link.
-- referral_qualifying_deposits_count (on the INVITED user) tracks how many of their
-- deposits have triggered a bonus for the referrer (max 3).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code                      text          UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by                        uuid          REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_earnings                  numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_registered_count          integer       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_qualifying_deposits_count integer       NOT NULL DEFAULT 0;

ALTER TABLE deposit_requests
  ADD COLUMN IF NOT EXISTS referral_bonus_applied boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referral_bonus_amount  numeric(12,2);

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'referral_bonus';

-- Backfill referral_code for users registered before this migration.
UPDATE profiles
SET referral_code = LOWER(SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 8))
WHERE referral_code IS NULL;

-- Rebuild handle_new_user to generate referral_code and resolve referred_by.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_referral_code text;
  v_ref_code      text;
  v_referrer_id   uuid;
  suffix          int := 0;
BEGIN
  -- Generate unique 8-char code; append suffix on collision (rare).
  LOOP
    v_referral_code := LOWER(SUBSTRING(REPLACE(NEW.id::text, '-', '') FROM 1 FOR 8));
    IF suffix > 0 THEN v_referral_code := v_referral_code || suffix::text; END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_referral_code);
    suffix := suffix + 1;
  END LOOP;

  -- Read ref_code passed in Supabase Auth metadata during signUp.
  v_ref_code := NEW.raw_user_meta_data->>'ref_code';
  IF v_ref_code IS NOT NULL AND v_ref_code <> '' THEN
    SELECT id INTO v_referrer_id
      FROM public.profiles
     WHERE referral_code = v_ref_code
     LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, nickname, referral_code, referred_by)
  VALUES (
    NEW.id,
    'user_' || LOWER(LEFT(REPLACE(NEW.id::text, '-', ''), 6)),
    v_referral_code,
    v_referrer_id
  );

  -- Increment referrer's registered-count counter.
  IF v_referrer_id IS NOT NULL THEN
    UPDATE public.profiles
       SET referral_registered_count = referral_registered_count + 1
     WHERE id = v_referrer_id;
  END IF;

  RETURN NEW;
END;
$$;
