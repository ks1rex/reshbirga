-- Adds an optional p_meta jsonb param to buy_gost_tokens so callers (reshbirga's
-- POST /gost/buy-tokens) can record VIP-discount audit info on the transaction row.
-- Backward compatible: existing callers omitting p_meta keep prior behavior (meta = NULL).
CREATE OR REPLACE FUNCTION public.buy_gost_tokens(
  p_user_id uuid,
  p_token_amount integer,
  p_rub_cost numeric,
  p_meta jsonb DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance numeric;
BEGIN
  SELECT balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  IF v_balance < p_rub_cost THEN RAISE EXCEPTION 'insufficient_balance'; END IF;
  UPDATE profiles
    SET balance       = balance - p_rub_cost,
        token_balance = token_balance + p_token_amount,
        updated_at    = now()
  WHERE id = p_user_id;
  INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
  VALUES (p_user_id, 'balance_to_token', p_rub_cost, 'completed', p_rub_cost, p_meta);
END;
$function$;
