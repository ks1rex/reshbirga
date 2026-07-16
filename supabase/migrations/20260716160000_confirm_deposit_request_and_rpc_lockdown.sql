-- Folds the "confirm deposit + referral bonus" flow (previously ~9 sequential
-- Express round-trips in POST /admin/deposits/:id/confirm, admin.js) into a
-- single atomic RPC — same pattern as purchase_vip
-- (0028_purchase_vip_atomic_ledger.sql) and buy_gost_tokens
-- (0030_gost_vip_discount.sql).
--
-- Why: per AUDIT_MIGRATION_SAFETY_2026.md / AUDIT_SECURITY_2026.md, the old
-- Express flow claimed the deposit_requests row as 'confirmed' *before*
-- actually crediting the depositor's wallet, and paid the referral bonus in
-- several more separate calls after that. A crash or network drop partway
-- through left the deposit marked confirmed with the depositor never
-- credited, or a referral slot consumed (via claim_referral_bonus_slot)
-- with the referrer never paid — no automatic recovery, manual ledger
-- reconciliation required. Wrapping the whole thing in one plpgsql function
-- means any failure rolls back the entire operation, never a partial state.
--
-- claim_referral_bonus_slot itself is NOT reimplemented here — it already
-- exists live (applied as migration version 20260613214919, "referral_slot_rpc",
-- see AUDIT_MIGRATION_DRIFT_2026.md for its full source and atomicity
-- analysis) and is called as-is via SELECT ... FOR UPDATE row-locking,
-- same as before.
--
-- Business logic preserved exactly from the old Express code:
-- - Atomic claim: deposit_requests.status 'pending' -> 'confirmed' (still the
--   same guard against double-processing/races).
-- - Depositor credited via add_wallet_balance, last_deposit_confirmed_at bumped.
-- - profiles.wallet_topup_total incremented (used by Express afterward for the
--   5000+ 'wallet_top' achievement grant — achievement granting itself stays
--   in Express, same as before; it isn't a money-moving operation).
-- - Referral eligibility: referrer must exist (profiles.referred_by) and
--   confirmed_amount >= referral_min_amount (default 100, from admin_settings).
--   Bonus % from admin_settings.referral_bonus_pct (default 5).
--   Slot capped via claim_referral_bonus_slot (referral_max_count, default 3).
-- - On bonus applied: 'deposit_referral' transaction for the depositor,
--   deposit_requests.referral_bonus_applied/referral_bonus_amount set,
--   referrer credited via add_wallet_balance + add_referral_earnings,
--   'referral_bonus' transaction for the referrer.
-- - On no bonus: plain 'deposit' transaction for the depositor.
-- - platform_profit is always 0 here — commission moved to withdrawal
--   (admin_settings.withdrawal_commission_pct), deposits are credited 1:1,
--   same as the code being replaced.
--
-- Output columns are all `out_`-prefixed on purpose: RETURNS TABLE(...)
-- implicitly declares each column as an in-scope PL/pgSQL variable, and an
-- unprefixed name like `user_id` would collide with the real
-- deposit_requests.user_id / profiles column of the same name — exactly the
-- ambiguous-column bug already fixed once in purchase_vip
-- (0032_fix_purchase_vip_ambiguous_column.sql). Prefixing sidesteps the
-- entire bug class instead of relying on careful qualification everywhere.

CREATE OR REPLACE FUNCTION confirm_deposit_request(
  p_deposit_id uuid,
  p_confirmed_amount numeric,
  p_processed_by uuid
)
RETURNS TABLE(
  out_success boolean,
  out_error_code text,
  out_credited_amount numeric,
  out_bonus_applied boolean,
  out_referral_bonus numeric,
  out_referrer_id uuid,
  out_wallet_topup_total numeric
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_depositor_id      uuid;
  v_referrer_id       uuid;
  v_referral_pct      numeric;
  v_referral_min      numeric;
  v_referral_bonus    numeric;
  v_pre_eligible      boolean;
  v_bonus_applied     boolean := false;
  v_topup_total       numeric;
  v_now               timestamptz := now();
  v_rows_updated      integer;
BEGIN
  IF p_confirmed_amount IS NULL OR p_confirmed_amount <= 0 THEN
    RAISE EXCEPTION 'confirm_deposit_request: p_confirmed_amount must be positive';
  END IF;

  -- Atomic claim — same guard as before: only a still-'pending' request can
  -- be confirmed, preventing double-processing under concurrent requests.
  UPDATE deposit_requests
  SET status           = 'confirmed',
      confirmed_amount = p_confirmed_amount,
      credited_amount  = p_confirmed_amount,
      processed_by     = p_processed_by,
      processed_at     = v_now
  WHERE id = p_deposit_id AND status = 'pending'
  RETURNING deposit_requests.user_id INTO v_depositor_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RETURN QUERY SELECT false, 'already_processed'::text,
      NULL::numeric, false, NULL::numeric, NULL::uuid, NULL::numeric;
    RETURN;
  END IF;

  -- Credit depositor's wallet (same atomic RPC as before, called from inside
  -- this transaction instead of as a separate round-trip).
  PERFORM add_wallet_balance(v_depositor_id, p_confirmed_amount);
  UPDATE profiles SET last_deposit_confirmed_at = v_now WHERE id = v_depositor_id;

  -- Cumulative top-up running total (Express grants the 'wallet_top'
  -- achievement afterward if this crosses 5000 — unchanged).
  UPDATE profiles
  SET wallet_topup_total = wallet_topup_total + p_confirmed_amount
  WHERE id = v_depositor_id
  RETURNING profiles.wallet_topup_total INTO v_topup_total;

  -- Referral eligibility — same rule as before.
  SELECT referred_by INTO v_referrer_id FROM profiles WHERE id = v_depositor_id;

  SELECT NULLIF(value, '')::numeric INTO v_referral_pct FROM admin_settings WHERE key = 'referral_bonus_pct';
  IF v_referral_pct IS NULL THEN v_referral_pct := 5; END IF;

  SELECT NULLIF(value, '')::numeric INTO v_referral_min FROM admin_settings WHERE key = 'referral_min_amount';
  IF v_referral_min IS NULL THEN v_referral_min := 100; END IF;

  v_referral_bonus := ROUND(p_confirmed_amount * (v_referral_pct / 100), 2);
  v_pre_eligible   := v_referrer_id IS NOT NULL AND p_confirmed_amount >= v_referral_min;

  -- Atomically claim a referral-bonus slot (existing RPC, called as-is —
  -- SELECT ... FOR UPDATE row-locks the referrer's profile row so concurrent
  -- confirms can never grant more than referral_max_count bonuses).
  IF v_pre_eligible THEN
    v_bonus_applied := claim_referral_bonus_slot(v_depositor_id);
  END IF;

  IF v_bonus_applied THEN
    -- deposit_referral: the deposit itself carries no platform profit
    -- (commission moved to withdrawal); referral bonus is paid out of
    -- platform withdrawal profit, not this deposit.
    INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
    VALUES (
      v_depositor_id, 'deposit_referral', p_confirmed_amount, 'completed', 0,
      jsonb_build_object(
        'referrer_id', v_referrer_id,
        'referrer_bonus', v_referral_bonus,
        'platform_profit_net', 0 - v_referral_bonus
      )
    );

    UPDATE deposit_requests
    SET referral_bonus_applied = true, referral_bonus_amount = v_referral_bonus
    WHERE id = p_deposit_id;

    -- Pay referral bonus
    PERFORM add_wallet_balance(v_referrer_id, v_referral_bonus);
    PERFORM add_referral_earnings(v_referrer_id, v_referral_bonus);

    INSERT INTO transactions (user_id, type, amount, status, meta)
    VALUES (
      v_referrer_id, 'referral_bonus', v_referral_bonus, 'completed',
      jsonb_build_object('from_user_id', v_depositor_id, 'deposit_amount', p_confirmed_amount)
    );
  ELSE
    -- Regular deposit: credited 1:1, no platform profit.
    INSERT INTO transactions (user_id, type, amount, status, platform_profit)
    VALUES (v_depositor_id, 'deposit', p_confirmed_amount, 'completed', 0);
  END IF;

  RETURN QUERY SELECT
    true, NULL::text, p_confirmed_amount, v_bonus_applied,
    CASE WHEN v_bonus_applied THEN v_referral_bonus ELSE 0 END,
    v_referrer_id, v_topup_total;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- URGENT fix, folded into this same migration: every financial/sensitive RPC
-- in the public schema — including the confirm_deposit_request just defined
-- above — carries Postgres's default EXECUTE grant to PUBLIC (which cascades
-- to anon/authenticated), meaning any authenticated user (or anon, in
-- principle) could call them directly via PostgREST, bypassing admin.js's
-- auth+is_admin gate entirely. For confirm_deposit_request specifically this
-- would let a user self-confirm their own pending deposit request with a
-- fabricated amount, crediting their wallet with money that was never
-- actually sent — exactly the manual-review step this endpoint exists for.
--
-- Confirmed via grep across ebu.gubkin, Sait (frontend), and reshbirga/Sait
-- backends: zero legitimate direct-from-frontend callers exist for any of
-- the 9 functions below — every one is called exclusively from
-- reshbirga/backend via the service-role client.
--
-- Deliberately NOT touched:
-- - is_admin() / is_conversation_participant(uuid) — used inside RLS
--   policies; revoking authenticated access would break those policies for
--   every ordinary user, not just attackers.
-- - consume_tokens(...) / redeem_code(text) (Sait) — intentionally called
--   with the end user's own JWT, not service-role (see
--   Sait/backend/app/billing.py), and are auth.uid()-scoped internally so a
--   caller can only ever affect their own row. Revoking authenticated here
--   would break Sait entirely.
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION add_wallet_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_wallet_balance(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION add_referral_earnings(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_referral_earnings(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION try_subtract_wallet_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_subtract_wallet_balance(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION buy_gost_tokens(uuid, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION buy_gost_tokens(uuid, integer, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION buy_gost_tokens(uuid, integer, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION buy_gost_tokens(uuid, integer, numeric, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION purchase_vip(uuid, integer, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purchase_vip(uuid, integer, numeric, text) TO service_role;

REVOKE EXECUTE ON FUNCTION claim_referral_bonus_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_referral_bonus_slot(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION create_deposit_request(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_deposit_request(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION increment_thread_views(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_thread_views(uuid) TO service_role;

-- The new function itself must not inherit the default PUBLIC grant either —
-- close it down in the same breath it's created.
REVOKE EXECUTE ON FUNCTION confirm_deposit_request(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_deposit_request(uuid, numeric, uuid) TO service_role;
