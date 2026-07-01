-- Stage 2 of VIP/fees plan: VIP core (status + purchase).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vip_expires_at timestamptz;

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'vip_purchase';

INSERT INTO admin_settings (key, value) VALUES
  ('vip_price_month',        '300'),
  ('vip_price_year',         '1500'),
  ('vip_duration_month_days','30'),
  ('vip_duration_year_days', '365'),
  ('vip_token_discount_pct', '20')
ON CONFLICT (key) DO NOTHING;

-- vip_expires_at must only ever be changed by the backend (service_role key —
-- no end-user JWT, so auth.uid() is null). Any request carrying a real user
-- session (direct client write attempt) is rejected, regardless of whatever
-- the legacy profiles_update_self column allowlist covers.
CREATE OR REPLACE FUNCTION protect_vip_expires_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'vip_expires_at can only be modified by the backend';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_vip_expires_at ON profiles;
CREATE TRIGGER trg_protect_vip_expires_at
  BEFORE UPDATE OF vip_expires_at ON profiles
  FOR EACH ROW
  WHEN (NEW.vip_expires_at IS DISTINCT FROM OLD.vip_expires_at)
  EXECUTE FUNCTION protect_vip_expires_at();

-- Atomic VIP purchase: balance deduction + cumulative expiry extension in one
-- statement (same check-and-subtract pattern as try_subtract_wallet_balance).
-- Returns TRUE if the balance was sufficient and the purchase went through.
CREATE OR REPLACE FUNCTION purchase_vip(p_user_id uuid, p_days integer, p_price numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rows_updated integer;
BEGIN
  UPDATE profiles
  SET balance        = balance - p_price,
      vip_expires_at = GREATEST(COALESCE(vip_expires_at, now()), now()) + make_interval(days => p_days)
  WHERE id = p_user_id AND balance >= p_price;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;
