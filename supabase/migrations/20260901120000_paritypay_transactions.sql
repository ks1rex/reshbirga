-- ParityPay (SBP) deposit gateway — second deposit method alongside Cashera
-- (crypto, 20260831120000_cashera_transactions.sql), with a customer-facing
-- commission Cashera's crypto path doesn't have. Own table, same shape/reasoning
-- as cashera_transactions: gateway-confirmed via webhook, not the manual
-- admin-reviewed deposit_requests flow.
--
-- credit_amount is computed and stored at invoice-creation time (pay_amount *
-- (1 - paritypay_commission_pct/100), see routes/wallet.js), NOT derived from
-- ParityPay's own `credited` field on the webhook. `credited` is what actually
-- lands in the merchant's ParityPay balance after *their* gateway fee — a
-- different, larger cut (their side takes ~6.8% per the product's example)
-- that the platform mostly absorbs itself. The user was only ever promised
-- "1.8% off your credited balance", so that promise — not ParityPay's actual
-- take — is what gets credited. parity_credited is kept alongside purely for
-- reconciliation/finance reporting (it's where the negative platform_profit
-- on this deposit comes from).
CREATE TABLE paritypay_transactions (
  external_id     text PRIMARY KEY,
  invoice_id      text UNIQUE,
  user_id         uuid NOT NULL REFERENCES profiles(id),
  status          text NOT NULL DEFAULT 'creating',
  pay_amount      numeric NOT NULL,
  credit_amount   numeric NOT NULL,
  parity_credited numeric,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Service-role only, same pattern as cashera_transactions/schedule_warmup_state.
ALTER TABLE paritypay_transactions ENABLE ROW LEVEL SECURITY;

-- Same idempotency shape as process_cashera_webhook: the UPDATE ... WHERE
-- status IS DISTINCT FROM p_new_status is the dedup guard, first (and only
-- first) transition into 'PAID' credits the wallet + runs the same
-- referral-bonus logic as confirm_deposit_request/process_cashera_webhook.
CREATE OR REPLACE FUNCTION process_paritypay_webhook(
  p_external_id     text,
  p_invoice_id      text,
  p_new_status      text,
  p_amount          numeric,
  p_parity_credited numeric
)
RETURNS TABLE(
  out_duplicate       boolean,
  out_mismatch        boolean,
  out_user_id         uuid,
  out_bonus_applied   boolean,
  out_referral_bonus  numeric
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row               paritypay_transactions%ROWTYPE;
  v_referrer_id       uuid;
  v_referral_pct      numeric;
  v_referral_min      numeric;
  v_referral_bonus    numeric;
  v_bonus_applied     boolean := false;
  v_platform_profit   numeric;
  v_rows_updated      integer;
BEGIN
  UPDATE paritypay_transactions
  SET status = p_new_status, invoice_id = COALESCE(paritypay_transactions.invoice_id, p_invoice_id),
      parity_credited = COALESCE(p_parity_credited, paritypay_transactions.parity_credited), updated_at = now()
  WHERE external_id = p_external_id AND status IS DISTINCT FROM p_new_status
  RETURNING * INTO v_row;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RETURN QUERY SELECT true, false, NULL::uuid, false, NULL::numeric;
    RETURN;
  END IF;

  IF p_new_status != 'PAID' THEN
    RETURN QUERY SELECT false, false, v_row.user_id, false, NULL::numeric;
    RETURN;
  END IF;

  IF v_row.pay_amount != p_amount THEN
    RETURN QUERY SELECT false, true, v_row.user_id, false, NULL::numeric;
    RETURN;
  END IF;

  PERFORM add_wallet_balance(v_row.user_id, v_row.credit_amount);
  UPDATE profiles
  SET last_deposit_confirmed_at = now(), wallet_topup_total = wallet_topup_total + v_row.credit_amount
  WHERE id = v_row.user_id;

  SELECT referred_by INTO v_referrer_id FROM profiles WHERE id = v_row.user_id;

  SELECT NULLIF(value, '')::numeric INTO v_referral_pct FROM admin_settings WHERE key = 'referral_bonus_pct';
  IF v_referral_pct IS NULL THEN v_referral_pct := 5; END IF;

  SELECT NULLIF(value, '')::numeric INTO v_referral_min FROM admin_settings WHERE key = 'referral_min_amount';
  IF v_referral_min IS NULL THEN v_referral_min := 100; END IF;

  v_referral_bonus := ROUND(v_row.credit_amount * (v_referral_pct / 100), 2);

  IF v_referrer_id IS NOT NULL AND v_row.credit_amount >= v_referral_min THEN
    v_bonus_applied := claim_referral_bonus_slot(v_row.user_id);
  END IF;

  -- Platform's real take on this deposit: what ParityPay actually credited us
  -- minus what we credited the user — negative here by design (the 5% we
  -- absorb ourselves), not a bug in the finance ledger.
  v_platform_profit := COALESCE(p_parity_credited, v_row.credit_amount) - v_row.credit_amount;

  IF v_bonus_applied THEN
    INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
    VALUES (
      v_row.user_id, 'deposit_referral', v_row.credit_amount, 'completed', v_platform_profit,
      jsonb_build_object(
        'referrer_id', v_referrer_id, 'referrer_bonus', v_referral_bonus,
        'paritypay_invoice_id', v_row.invoice_id, 'paritypay_external_id', p_external_id,
        'pay_amount', v_row.pay_amount, 'parity_credited', p_parity_credited
      )
    );
    PERFORM add_wallet_balance(v_referrer_id, v_referral_bonus);
    PERFORM add_referral_earnings(v_referrer_id, v_referral_bonus);
    INSERT INTO transactions (user_id, type, amount, status, meta)
    VALUES (
      v_referrer_id, 'referral_bonus', v_referral_bonus, 'completed',
      jsonb_build_object('from_user_id', v_row.user_id, 'deposit_amount', v_row.credit_amount)
    );
  ELSE
    INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
    VALUES (
      v_row.user_id, 'deposit', v_row.credit_amount, 'completed', v_platform_profit,
      jsonb_build_object('paritypay_invoice_id', v_row.invoice_id, 'paritypay_external_id', p_external_id,
                          'pay_amount', v_row.pay_amount, 'parity_credited', p_parity_credited)
    );
  END IF;

  RETURN QUERY SELECT false, false, v_row.user_id, v_bonus_applied,
    CASE WHEN v_bonus_applied THEN v_referral_bonus ELSE NULL::numeric END;
END;
$$;

REVOKE EXECUTE ON FUNCTION process_paritypay_webhook(text, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_paritypay_webhook(text, text, text, numeric, numeric) TO service_role;

-- Customer-facing cut on a ParityPay (SBP) deposit — 1.8%, see routes/wallet.js.
-- Same no-ON-CONFLICT pattern as 20260831130000_withdrawal_phone_only.sql:
-- admin_settings' real constraints aren't in this repo's migration history.
INSERT INTO admin_settings (key, value)
SELECT 'paritypay_commission_pct', '1.8'
WHERE NOT EXISTS (SELECT 1 FROM admin_settings WHERE key = 'paritypay_commission_pct');
