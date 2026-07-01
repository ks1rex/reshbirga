-- Bug fix: purchase_vip's RETURNS TABLE(success boolean, vip_expires_at timestamptz)
-- creates an implicit PL/pgSQL OUT variable named vip_expires_at, which collides
-- with the profiles.vip_expires_at column read inside
-- COALESCE(vip_expires_at, now()) in the UPDATE — Postgres error 42702
-- "column reference is ambiguous", failing every VIP purchase at runtime
-- (caught by smoke_test.js Step 15, never actually exercised end-to-end before).
-- Fix: rename the OUT parameter so there's no name collision at all.

DROP FUNCTION IF EXISTS purchase_vip(uuid, integer, numeric, text);

CREATE OR REPLACE FUNCTION purchase_vip(p_user_id uuid, p_days integer, p_price numeric, p_plan text)
RETURNS TABLE(success boolean, new_vip_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  computed_expiry timestamptz;
  rows_updated     integer;
BEGIN
  IF p_days <= 0 THEN
    RAISE EXCEPTION 'purchase_vip: p_days must be positive';
  END IF;
  IF p_price < 0 THEN
    RAISE EXCEPTION 'purchase_vip: p_price must be non-negative';
  END IF;

  UPDATE profiles
  SET balance        = balance - p_price,
      vip_expires_at = GREATEST(COALESCE(profiles.vip_expires_at, now()), now()) + make_interval(days => p_days)
  WHERE id = p_user_id AND balance >= p_price
  RETURNING profiles.vip_expires_at INTO computed_expiry;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    RETURN QUERY SELECT false, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
  VALUES (p_user_id, 'vip_purchase', p_price, 'completed', p_price,
          jsonb_build_object('plan', p_plan, 'days', p_days));

  RETURN QUERY SELECT true, computed_expiry;
END;
$$;
