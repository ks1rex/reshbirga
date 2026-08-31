-- Cashera payment gateway integration: gateway-side deposits, auto-credited
-- via webhook instead of the admin-reviewed deposit_requests flow. Kept as
-- its own table rather than reused inside deposit_requests — that table's
-- shape (claimed_amount vs confirmed_amount, admin processed_by) is built
-- around a human claiming "I sent money, please confirm", which doesn't fit
-- a gateway that confirms itself.
--
-- amount is stored in MINOR units (kopecks) — same convention Cashera uses
-- over the wire — so the row is a straight mirror of the gateway's own
-- transaction object, not a converted one.
CREATE TABLE cashera_transactions (
  external_id     text PRIMARY KEY,
  uuid            text UNIQUE,
  user_id         uuid NOT NULL REFERENCES profiles(id),
  status          text NOT NULL DEFAULT 'creating',
  amount          integer NOT NULL,
  currency        text NOT NULL DEFAULT 'RUB',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Service-role only, same pattern as schedule_warmup_state / order-attachments:
-- RLS enabled with zero policies means anon/authenticated get denied by
-- default via PostgREST, while the Express service-role client (which is the
-- only real caller) bypasses RLS entirely.
ALTER TABLE cashera_transactions ENABLE ROW LEVEL SECURITY;

-- Atomically applies one webhook event: advances cashera_transactions.status
-- and, the first (and only the first) time it becomes 'paid', credits the
-- depositor's deposited_balance and pays a referral bonus — same business
-- rule as confirm_deposit_request (20260716160000).
--
-- Idempotency is the status-change itself: the UPDATE ... WHERE status IS
-- DISTINCT FROM p_new_status only succeeds once per transition, so a
-- retried/duplicated webhook for a status already recorded is a no-op
-- (out_duplicate = true) — no separate "credited" flag needed, and no race
-- between two concurrent deliveries of the same event.
--
-- p_amount/p_currency are compared against the row Express created *before*
-- calling Cashera, as a sanity check against a forged webhook trying to
-- credit a different amount than what was actually requested.
--
-- ponytail: refunded/chargeback arriving after paid don't reverse the
-- credit here — Cashera's docs don't specify that flow, and reversing an
-- already-spent deposit is an admin/dispute decision, not something to
-- guess at. Add if Cashera is confirmed to send those post-paid.
CREATE OR REPLACE FUNCTION process_cashera_webhook(
  p_external_id text,
  p_uuid         text,
  p_new_status   text,
  p_amount       integer,
  p_currency     text
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
  v_row               cashera_transactions%ROWTYPE;
  v_amount_rub        numeric;
  v_referrer_id       uuid;
  v_referral_pct      numeric;
  v_referral_min      numeric;
  v_referral_bonus    numeric;
  v_bonus_applied     boolean := false;
  v_rows_updated      integer;
BEGIN
  UPDATE cashera_transactions
  SET status = p_new_status, uuid = COALESCE(cashera_transactions.uuid, p_uuid), updated_at = now()
  WHERE external_id = p_external_id AND status IS DISTINCT FROM p_new_status
  RETURNING * INTO v_row;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RETURN QUERY SELECT true, false, NULL::uuid, false, NULL::numeric;
    RETURN;
  END IF;

  IF p_new_status != 'paid' THEN
    RETURN QUERY SELECT false, false, v_row.user_id, false, NULL::numeric;
    RETURN;
  END IF;

  IF v_row.amount != p_amount OR v_row.currency != p_currency THEN
    RETURN QUERY SELECT false, true, v_row.user_id, false, NULL::numeric;
    RETURN;
  END IF;

  v_amount_rub := p_amount / 100.0;

  PERFORM add_wallet_balance(v_row.user_id, v_amount_rub);
  UPDATE profiles
  SET last_deposit_confirmed_at = now(), wallet_topup_total = wallet_topup_total + v_amount_rub
  WHERE id = v_row.user_id;

  SELECT referred_by INTO v_referrer_id FROM profiles WHERE id = v_row.user_id;

  SELECT NULLIF(value, '')::numeric INTO v_referral_pct FROM admin_settings WHERE key = 'referral_bonus_pct';
  IF v_referral_pct IS NULL THEN v_referral_pct := 5; END IF;

  SELECT NULLIF(value, '')::numeric INTO v_referral_min FROM admin_settings WHERE key = 'referral_min_amount';
  IF v_referral_min IS NULL THEN v_referral_min := 100; END IF;

  v_referral_bonus := ROUND(v_amount_rub * (v_referral_pct / 100), 2);

  IF v_referrer_id IS NOT NULL AND v_amount_rub >= v_referral_min THEN
    v_bonus_applied := claim_referral_bonus_slot(v_row.user_id);
  END IF;

  IF v_bonus_applied THEN
    INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
    VALUES (
      v_row.user_id, 'deposit_referral', v_amount_rub, 'completed', 0,
      jsonb_build_object(
        'referrer_id', v_referrer_id, 'referrer_bonus', v_referral_bonus,
        'platform_profit_net', 0 - v_referral_bonus,
        'cashera_uuid', v_row.uuid, 'cashera_external_id', p_external_id
      )
    );
    PERFORM add_wallet_balance(v_referrer_id, v_referral_bonus);
    PERFORM add_referral_earnings(v_referrer_id, v_referral_bonus);
    INSERT INTO transactions (user_id, type, amount, status, meta)
    VALUES (
      v_referrer_id, 'referral_bonus', v_referral_bonus, 'completed',
      jsonb_build_object('from_user_id', v_row.user_id, 'deposit_amount', v_amount_rub)
    );
  ELSE
    INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
    VALUES (
      v_row.user_id, 'deposit', v_amount_rub, 'completed', 0,
      jsonb_build_object('cashera_uuid', v_row.uuid, 'cashera_external_id', p_external_id)
    );
  END IF;

  RETURN QUERY SELECT false, false, v_row.user_id, v_bonus_applied,
    CASE WHEN v_bonus_applied THEN v_referral_bonus ELSE NULL::numeric END;
END;
$$;

-- Every new money-moving RPC ships REVOKE+GRANT in the same migration, per
-- CLAUDE.md "New rule, non-negotiable" — default PUBLIC execute grant would
-- otherwise let any authenticated/anon caller credit their own wallet
-- directly via PostgREST, bypassing the webhook's key/secret check entirely.
REVOKE EXECUTE ON FUNCTION process_cashera_webhook(text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_cashera_webhook(text, text, text, integer, text) TO service_role;
