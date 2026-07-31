-- Финансовая модель, этап 2: два баланса вместо одного + комиссия биржи.
--
-- Timestamp-версия по конвенции (см. CLAUDE.md «Migration history»): локальная
-- нумерация 0001-0036 разошлась с реальной историей проекта, новые миграции
-- именуются YYYYMMDDHHMMSS_*.
--
-- Что здесь:
--   1. profiles.deposited_balance / earned_balance — «занесённый» (из пополнений)
--      и «заработанный» (биржа + рефералка) баланс. profiles.balance остаётся
--      суммой этих двух — его читают Navbar, витрины, админка, Sait; ломать
--      всех читателей ради переименования смысла нет. Инвариант держит CHECK.
--   2. Списание при любой трате (VIP, ГОСТ-токены, оплата на бирже) —
--      сначала deposited_balance, остаток с earned_balance. Единая точка —
--      try_subtract_wallet_balance (сигнатура не менялась, все вызовы в
--      Express продолжают работать как есть).
--   3. withdrawal_requests.withdrawal_method ('sbp'|'card') и source_balance
--      ('deposited'|'earned') — вывод всегда с одного баланса, минимум зависит
--      от способа (СБП 500 ₽, карта 4000 ₽), комиссия — от источника
--      (занесённый 10%, заработанный 0%). Проверки в routes/wallet.js.
--   4. admin_settings.marketplace_commission_pct — наценка покупателю на бирже
--      (+10% сверх отображаемой цены; продавец получает цену целиком).
--
-- Реальной отправки денег (PayAnyWay и т.п.) здесь нет и не предполагается —
-- это только внутренний учёт, см. TODO_BACKEND.md.

-- ─── 1. Два баланса ──────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deposited_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS earned_balance    numeric NOT NULL DEFAULT 0;

-- Перенос: весь текущий баланс считаем занесённым. Безопасное предположение —
-- биржевой комиссии до этой миграции не было, деньги приходили пополнением.
-- ВНИМАНИЕ: одноразовый шаг, повторный прогон миграции обнулит earned_balance.
UPDATE profiles
SET deposited_balance = balance,
    earned_balance    = 0
WHERE deposited_balance = 0 AND earned_balance = 0 AND balance <> 0;

-- Инвариант вместо доверия к коду: если появится ещё один писатель balance,
-- мимо функций ниже, он упадёт здесь, а не разъедется тихо.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_balance_split_chk;
ALTER TABLE profiles ADD  CONSTRAINT profiles_balance_split_chk
  CHECK (balance = deposited_balance + earned_balance);

-- ─── 2. Атомарные функции над балансами ──────────────────────────────────────

-- Пополнение «занесённого» — сигнатура не менялась, поэтому все существующие
-- вызовы (возвраты, откаты, разблокировка залога) по умолчанию кладут деньги
-- сюда. Это осознанно консервативно: возврат средств на deposited_balance
-- максимум невыгоден пользователю (10% при выводе), тогда как возврат на
-- earned_balance открыл бы отмывание «занесённых» денег через
-- создать-заказ-и-отменить, минуя комиссию за вывод.
-- ponytail: возврат не помнит, из какого баланса реально списывали; чтобы
-- вернуть точно в earned, пришлось бы хранить разбивку на самом заказе.
CREATE OR REPLACE FUNCTION add_wallet_balance(p_user_id uuid, p_amount numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  UPDATE profiles
  SET deposited_balance = deposited_balance + p_amount,
      balance           = balance + p_amount
  WHERE id = p_user_id;
$$;

-- Пополнение «заработанного»: выплаты исполнителю, залог в пользу исполнителя
-- по спору, реферальные бонусы.
CREATE OR REPLACE FUNCTION add_earned_balance(p_user_id uuid, p_amount numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  UPDATE profiles
  SET earned_balance = earned_balance + p_amount,
      balance        = balance + p_amount
  WHERE id = p_user_id;
$$;

-- Любая трата: сначала занесённый, недостающее — с заработанного.
-- Возвращает TRUE, если денег хватило (сигнатура и семантика для вызывающих
-- не изменились).
CREATE OR REPLACE FUNCTION try_subtract_wallet_balance(p_user_id uuid, p_amount numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  rows_updated integer;
BEGIN
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'try_subtract_wallet_balance: p_amount must be non-negative';
  END IF;

  -- В UPDATE все ссылки на колонки справа читают старые значения строки,
  -- поэтому LEAST(deposited_balance, p_amount) — это «сколько реально есть
  -- на занесённом», а остаток уходит с заработанного. Условие balance >=
  -- p_amount гарантирует, что earned_balance не уйдёт в минус.
  UPDATE profiles
  SET deposited_balance = deposited_balance - LEAST(deposited_balance, p_amount),
      earned_balance    = earned_balance - (p_amount - LEAST(deposited_balance, p_amount)),
      balance           = balance - p_amount
  WHERE id = p_user_id AND balance >= p_amount;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

-- Списание строго с одного баланса — нужно только выводу: заявка на вывод
-- всегда указывает источник, смешанных заявок нет (см. routes/wallet.js).
CREATE OR REPLACE FUNCTION try_subtract_bucket_balance(p_user_id uuid, p_amount numeric, p_bucket text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  rows_updated integer;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'try_subtract_bucket_balance: p_amount must be positive';
  END IF;
  IF p_bucket NOT IN ('deposited', 'earned') THEN
    RAISE EXCEPTION 'try_subtract_bucket_balance: p_bucket must be deposited|earned';
  END IF;

  IF p_bucket = 'deposited' THEN
    UPDATE profiles
    SET deposited_balance = deposited_balance - p_amount,
        balance           = balance - p_amount
    WHERE id = p_user_id AND deposited_balance >= p_amount;
  ELSE
    UPDATE profiles
    SET earned_balance = earned_balance - p_amount,
        balance        = balance - p_amount
    WHERE id = p_user_id AND earned_balance >= p_amount;
  END IF;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

-- ─── 3. Существующие money-RPC переводим на общую точку списания ─────────────

-- purchase_vip: тот же контракт (успех/новая дата), но деньги списываются
-- через try_subtract_wallet_balance — иначе VIP покупался бы мимо разбивки
-- и уронил бы CHECK выше. Прежняя защита от ambiguous column
-- (0032_fix_purchase_vip_ambiguous_column.sql) сохранена: OUT-параметр
-- по-прежнему называется new_vip_expires_at.
CREATE OR REPLACE FUNCTION purchase_vip(p_user_id uuid, p_days integer, p_price numeric, p_plan text)
RETURNS TABLE(success boolean, new_vip_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  computed_expiry timestamptz;
BEGIN
  IF p_days <= 0 THEN
    RAISE EXCEPTION 'purchase_vip: p_days must be positive';
  END IF;
  IF p_price < 0 THEN
    RAISE EXCEPTION 'purchase_vip: p_price must be non-negative';
  END IF;

  IF NOT try_subtract_wallet_balance(p_user_id, p_price) THEN
    RETURN QUERY SELECT false, NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE profiles
  SET vip_expires_at = GREATEST(COALESCE(profiles.vip_expires_at, now()), now()) + make_interval(days => p_days)
  WHERE id = p_user_id
  RETURNING profiles.vip_expires_at INTO computed_expiry;

  INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
  VALUES (p_user_id, 'vip_purchase', p_price, 'completed', p_price,
          jsonb_build_object('plan', p_plan, 'days', p_days));

  RETURN QUERY SELECT true, computed_expiry;
END;
$$;

-- buy_gost_tokens: то же самое — списание через общую функцию. Текст ошибки
-- 'insufficient_balance' сохранён, его матчит routes/gost.js.
CREATE OR REPLACE FUNCTION buy_gost_tokens(
  p_user_id uuid,
  p_token_amount integer,
  p_rub_cost numeric,
  p_meta jsonb DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT try_subtract_wallet_balance(p_user_id, p_rub_cost) THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  UPDATE profiles
  SET token_balance = token_balance + p_token_amount,
      updated_at    = now()
  WHERE id = p_user_id;

  INSERT INTO transactions (user_id, type, amount, status, platform_profit, meta)
  VALUES (p_user_id, 'balance_to_token', p_rub_cost, 'completed', p_rub_cost, p_meta);
END;
$$;

-- Старая трёхаргументная перегрузка писала balance напрямую (и после CHECK
-- выше падала бы). Живых вызовов нет — единственный вызывающий,
-- routes/gost.js, передаёт p_meta.
DROP FUNCTION IF EXISTS public.buy_gost_tokens(uuid, integer, numeric);

-- confirm_deposit_request: единственное изменение против
-- 20260716160000_confirm_deposit_request_and_rpc_lockdown.sql — реферальный
-- бонус зачисляется на earned_balance (add_earned_balance), а сам депозит
-- по-прежнему на deposited_balance. Остальная логика и комментарии там же.
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

  -- Пополнение — всегда «занесённый» баланс.
  PERFORM add_wallet_balance(v_depositor_id, p_confirmed_amount);
  UPDATE profiles SET last_deposit_confirmed_at = v_now WHERE id = v_depositor_id;

  UPDATE profiles
  SET wallet_topup_total = wallet_topup_total + p_confirmed_amount
  WHERE id = v_depositor_id
  RETURNING profiles.wallet_topup_total INTO v_topup_total;

  SELECT referred_by INTO v_referrer_id FROM profiles WHERE id = v_depositor_id;

  SELECT NULLIF(value, '')::numeric INTO v_referral_pct FROM admin_settings WHERE key = 'referral_bonus_pct';
  IF v_referral_pct IS NULL THEN v_referral_pct := 5; END IF;

  SELECT NULLIF(value, '')::numeric INTO v_referral_min FROM admin_settings WHERE key = 'referral_min_amount';
  IF v_referral_min IS NULL THEN v_referral_min := 100; END IF;

  v_referral_bonus := ROUND(p_confirmed_amount * (v_referral_pct / 100), 2);
  v_pre_eligible   := v_referrer_id IS NOT NULL AND p_confirmed_amount >= v_referral_min;

  IF v_pre_eligible THEN
    v_bonus_applied := claim_referral_bonus_slot(v_depositor_id);
  END IF;

  IF v_bonus_applied THEN
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

    -- Реферальный бонус — доход пользователя, а не его пополнение:
    -- на «заработанный» баланс, выводится без комиссии.
    PERFORM add_earned_balance(v_referrer_id, v_referral_bonus);
    PERFORM add_referral_earnings(v_referrer_id, v_referral_bonus);

    INSERT INTO transactions (user_id, type, amount, status, meta)
    VALUES (
      v_referrer_id, 'referral_bonus', v_referral_bonus, 'completed',
      jsonb_build_object('from_user_id', v_depositor_id, 'deposit_amount', p_confirmed_amount)
    );
  ELSE
    INSERT INTO transactions (user_id, type, amount, status, platform_profit)
    VALUES (v_depositor_id, 'deposit', p_confirmed_amount, 'completed', 0);
  END IF;

  RETURN QUERY SELECT
    true, NULL::text, p_confirmed_amount, v_bonus_applied,
    CASE WHEN v_bonus_applied THEN v_referral_bonus ELSE 0 END,
    v_referrer_id, v_topup_total;
END;
$$;

-- ─── 4. Заявки на вывод: способ и источник ───────────────────────────────────

ALTER TABLE withdrawal_requests
  ADD COLUMN IF NOT EXISTS withdrawal_method text NOT NULL DEFAULT 'sbp',
  ADD COLUMN IF NOT EXISTS source_balance    text NOT NULL DEFAULT 'deposited';

ALTER TABLE withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_method_chk;
ALTER TABLE withdrawal_requests ADD  CONSTRAINT withdrawal_requests_method_chk
  CHECK (withdrawal_method IN ('sbp', 'card'));

ALTER TABLE withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_source_chk;
ALTER TABLE withdrawal_requests ADD  CONSTRAINT withdrawal_requests_source_chk
  CHECK (source_balance IN ('deposited', 'earned'));

-- ─── 5. Наценка покупателю на бирже ──────────────────────────────────────────

-- Отображаемая цена одинакова для покупателя и продавца; покупатель платит
-- цену × (1 + pct/100), продавцу уходит цена целиком, разница — доход
-- платформы (пишется в transactions.platform_profit при завершении сделки).
INSERT INTO admin_settings (key, value)
VALUES ('marketplace_commission_pct', '10')
ON CONFLICT (key) DO NOTHING;

-- ─── 6. Права ────────────────────────────────────────────────────────────────
-- Правило из CLAUDE.md: у любой money-функции REVOKE ... FROM PUBLIC, anon,
-- authenticated + GRANT ... TO service_role в той же миграции, где она
-- создана/пересоздана. CREATE OR REPLACE гранты не сбрасывает, но повторить
-- дешевле, чем однажды забыть.

REVOKE EXECUTE ON FUNCTION add_wallet_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION add_wallet_balance(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION add_earned_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION add_earned_balance(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION try_subtract_wallet_balance(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION try_subtract_wallet_balance(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION try_subtract_bucket_balance(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION try_subtract_bucket_balance(uuid, numeric, text) TO service_role;

REVOKE EXECUTE ON FUNCTION purchase_vip(uuid, integer, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION purchase_vip(uuid, integer, numeric, text) TO service_role;

REVOKE EXECUTE ON FUNCTION buy_gost_tokens(uuid, integer, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION buy_gost_tokens(uuid, integer, numeric, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION confirm_deposit_request(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION confirm_deposit_request(uuid, numeric, uuid) TO service_role;
