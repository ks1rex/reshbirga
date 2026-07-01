-- Security-review fix on purchase_vip (0027_vip.sql):
-- HIGH: the transactions ledger insert was done separately in Express after
--   the RPC returned — if that insert failed (or the process died in between),
--   money was already deducted and VIP already granted with no ledger row.
-- LOW: the route did a second SELECT for vip_expires_at after the RPC — wasteful
--   and could reflect a concurrent purchase's value under heavy contention.
-- Fix: fold the transactions insert into the same statement/transaction as the
-- balance deduction + expiry extension, and RETURN the new expiry directly.

DROP FUNCTION IF EXISTS purchase_vip(uuid, integer, numeric);

CREATE OR REPLACE FUNCTION purchase_vip(p_user_id uuid, p_days integer, p_price numeric, p_plan text)
RETURNS TABLE(success boolean, vip_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_expiry   timestamptz;
  rows_updated integer;
BEGIN
  -- LOW: guard against a misconfigured admin_settings row (e.g. a typo'd
  -- negative price/duration) rather than silently applying it.
  IF p_days <= 0 THEN
    RAISE EXCEPTION 'purchase_vip: p_days must be positive';
  END IF;
  IF p_price < 0 THEN
    RAISE EXCEPTION 'purchase_vip: p_price must be non-negative';
  END IF;

  UPDATE profiles
  SET balance        = balance - p_price,
      vip_expires_at = GREATEST(COALESCE(vip_expires_at, now()), now()) + make_interval(days => p_days)
  WHERE id = p_user_id AND balance >= p_price
  RETURNING profiles.vip_expires_at INTO new_expiry;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RETURN QUERY SELECT false, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
  VALUES (p_user_id, 'vip_purchase', p_price, 'completed', p_price,
          jsonb_build_object('plan', p_plan, 'days', p_days));

  RETURN QUERY SELECT true, new_expiry;
END;
$$;
