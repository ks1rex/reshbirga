-- RPC called by the backend when crediting a referral bonus to a referrer.
-- Increments referral_earnings so the referrer can see their lifetime earnings
-- in the Wallet page without scanning the full transactions ledger.

CREATE OR REPLACE FUNCTION add_referral_earnings(p_user_id uuid, p_amount numeric)
RETURNS void
LANGUAGE sql SECURITY DEFINER
AS $$
  UPDATE public.profiles
     SET referral_earnings = referral_earnings + p_amount
   WHERE id = p_user_id;
$$;
