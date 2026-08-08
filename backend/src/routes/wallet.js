const { Router } = require('express');
const auth = require('../middleware/auth');
const isBanned = require('../middleware/isBanned');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');
const { sendTelegram } = require('../utils/telegramNotify');
const { vipDiscountPct, applyVipDiscount, parseLevelDiscounts } = require('../utils/vip');
const { fetchAll } = require('../utils/pagedFetch');

const router = Router();
router.use(auth);

// GET /wallet — balance + last 5 of each request type + referral info
router.get('/', async (req, res) => {
  const [profileRes, depositsRes, withdrawalsRes] = await Promise.all([
    supabase.from('profiles')
      .select('balance, deposited_balance, earned_balance, referral_code, referral_earnings, referral_registered_count, vip_expires_at')
      .eq('id', req.userId).single(),
    supabase.from('deposit_requests')
      .select('id, claimed_amount, confirmed_amount, credited_amount, status, admin_comment, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('withdrawal_requests')
      .select('id, amount, card_number, withdrawal_method, source_balance, status, admin_comment, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  if (profileRes.error) return serverError(res, profileRes.error);

  const prof = profileRes.data;
  const frontendBase = (process.env.FRONTEND_URL || '').split(',')[0].trim();
  const referralCode = prof?.referral_code ?? null;

  res.json({
    balance: parseFloat(prof?.balance ?? 0),
    deposited_balance: parseFloat(prof?.deposited_balance ?? 0),
    earned_balance: parseFloat(prof?.earned_balance ?? 0),
    referral_code: referralCode,
    referral_link: referralCode ? `${frontendBase}/register?ref=${referralCode}` : null,
    referral_earnings: parseFloat(prof?.referral_earnings ?? 0),
    referral_registered_count: prof?.referral_registered_count ?? 0,
    vip_expires_at: prof?.vip_expires_at ?? null,
    recent_deposits: depositsRes.data ?? [],
    recent_withdrawals: withdrawalsRes.data ?? [],
  });
});

const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const INCOME_TYPES  = ['deposit', 'deposit_referral', 'referral_bonus'];
const OUTCOME_TYPES = ['withdrawal', 'balance_to_token'];

// GET /wallet/chart — last 6 months of income/outcome
router.get('/chart', async (req, res) => {
  const since = new Date();
  since.setMonth(since.getMonth() - 5, 1);
  since.setHours(0, 0, 0, 0);

  const { data: txs, error } = await supabase
    .from('transactions')
    .select('type, amount, created_at')
    .eq('user_id', req.userId)
    .eq('status', 'completed')
    .in('type', [...INCOME_TYPES, ...OUTCOME_TYPES])
    .gte('created_at', since.toISOString());
  if (error) return serverError(res, error);

  const months = [];
  const income = [];
  const outcome = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    months.push(MONTH_NAMES[d.getMonth()]);
    income.push(0);
    outcome.push(0);
  }

  for (const tx of txs ?? []) {
    const d = new Date(tx.created_at);
    const monthsAgo = (since.getFullYear() === d.getFullYear())
      ? d.getMonth() - since.getMonth()
      : d.getMonth() - since.getMonth() + 12 * (d.getFullYear() - since.getFullYear());
    if (monthsAgo < 0 || monthsAgo > 5) continue;
    const amount = parseFloat(tx.amount ?? 0);
    if (INCOME_TYPES.includes(tx.type)) income[monthsAgo] += amount;
    else outcome[monthsAgo] += amount;
  }

  res.json({ months, income, outcome });
});

// POST /wallet/deposits — create deposit request
router.post('/deposits', isBanned, async (req, res) => {
  const claimed_amount = parseFloat(req.body.claimed_amount);
  if (!claimed_amount || claimed_amount <= 0 || isNaN(claimed_amount))
    return res.status(400).json({ error: 'Укажите сумму перевода больше 0' });
  if (claimed_amount > 500_000)
    return res.status(400).json({ error: 'Сумма слишком большая' });

  // Atomic count+insert with per-user advisory lock (prevents TOCTOU on the 3/hour limit)
  const { data, error } = await supabase
    .rpc('create_deposit_request', { p_user_id: req.userId, p_amount: claimed_amount })
    .single();

  if (error) {
    if (error.message?.includes('deposit_rate_limit'))
      return res.status(429).json({ error: 'Превышен лимит запросов на пополнение (3 в час), попробуйте позже.' });
    return serverError(res, error, 'wallet:deposit:create');
  }

  const { data: prof } = await supabase.from('profiles').select('nickname').eq('id', req.userId).single();
  sendTelegram(`💰 Заявка на пополнение\nПользователь: @${prof?.nickname ?? req.userId}\nСумма: ${claimed_amount} ₽`);

  res.status(201).json(data);
});

// GET /wallet/deposits — full history
router.get('/deposits', async (req, res) => {
  const { data, error } = await supabase
    .from('deposit_requests')
    .select('id, claimed_amount, confirmed_amount, credited_amount, status, admin_comment, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// GET /wallet/withdrawals — full history
router.get('/withdrawals', async (req, res) => {
  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select('id, amount, card_number, withdrawal_method, source_balance, status, admin_comment, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// GET /wallet/referrals — кого пригласил и сколько принёс каждый.
// Число пополнений приглашённого сознательно не отдаётся: это админская
// информация, реферер видит только ник и свой заработок.
router.get('/referrals', async (req, res) => {
  const { data: invited, error } = await supabase
    .from('profiles')
    .select('id, nickname, created_at')
    .eq('referred_by', req.userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return serverError(res, error);
  if (!invited?.length) return res.json([]);

  // Бонус привязан к приглашённому через meta.from_user_id — так его пишет
  // confirm_deposit_request (см. 20260716160000_..._rpc_lockdown.sql).
  const { data: bonuses, error: txError, truncated } = await fetchAll(() =>
    supabase.from('transactions')
      .select('amount, meta')
      .eq('user_id', req.userId)
      .eq('type', 'referral_bonus'));
  if (txError) return serverError(res, txError, 'wallet:referrals');
  if (truncated) console.warn(`wallet:referrals: bonus list truncated for ${req.userId}`);

  const earned = {};
  for (const t of bonuses) {
    const from = t.meta?.from_user_id;
    if (from) earned[from] = (earned[from] ?? 0) + (parseFloat(t.amount) || 0);
  }

  res.json(invited.map(u => ({
    id: u.id,
    nickname: u.nickname,
    registered_at: u.created_at,
    earned: Math.round((earned[u.id] ?? 0) * 100) / 100,
  })));
});

// Минимум вывода зависит от способа: СБП дешевле в обработке, карта — дороже.
const WITHDRAWAL_MIN = { sbp: 500, card: 4000 };
const METHOD_LABEL   = { sbp: 'СБП', card: 'карта' };
const SOURCE_LABEL   = { deposited: 'занесённый', earned: 'заработанный' };

// POST /wallet/withdrawals — create withdrawal request (deducts balance as reserve)
//
// Заявка всегда с одного баланса: смешанного вывода нет. Если на занесённом
// не хватает, а на заработанном есть — это две отдельные заявки, потому что у
// них разная комиссия (10% против 0%), и одна строка withdrawal_requests не
// может нести две ставки сразу.
router.post('/withdrawals', isBanned, async (req, res) => {
  const amount = parseFloat(req.body.amount);
  const card_number = req.body.card_number?.trim();
  const method = req.body.withdrawal_method ?? 'sbp';
  const source = req.body.source_balance ?? 'deposited';

  if (!amount || amount <= 0 || isNaN(amount))
    return res.status(400).json({ error: 'Укажите сумму больше 0' });
  if (!WITHDRAWAL_MIN[method])
    return res.status(400).json({ error: 'Некорректный способ вывода (sbp/card)' });
  if (!SOURCE_LABEL[source])
    return res.status(400).json({ error: 'Некорректный баланс списания (deposited/earned)' });
  if (amount < WITHDRAWAL_MIN[method])
    return res.status(400).json({ error: `Минимальная сумма вывода на ${METHOD_LABEL[method]} — ${WITHDRAWAL_MIN[method]} ₽` });
  if (!card_number)
    return res.status(400).json({ error: 'Укажите реквизиты для вывода' });
  if (card_number.length > 100)
    return res.status(400).json({ error: 'Реквизиты слишком длинные' });

  // Atomic deduct from the chosen bucket only — fails if that bucket is short,
  // даже если суммарного баланса хватило бы.
  const { data: ok, error: rpcErr } = await supabase
    .rpc('try_subtract_bucket_balance', { p_user_id: req.userId, p_amount: amount, p_bucket: source });

  if (rpcErr) return serverError(res, rpcErr, 'wallet:withdraw:rpc');
  if (!ok) return res.status(400).json({
    error: `Недостаточно средств на балансе «${SOURCE_LABEL[source]}»`,
    code: 'INSUFFICIENT_BUCKET_BALANCE',
  });

  const { data, error } = await supabase
    .from('withdrawal_requests')
    .insert({ user_id: req.userId, amount, card_number, status: 'pending',
              withdrawal_method: method, source_balance: source })
    .select()
    .single();

  if (error) {
    // Roll back the deduction into the same bucket it came from
    await supabase.rpc(source === 'earned' ? 'add_earned_balance' : 'add_wallet_balance',
      { p_user_id: req.userId, p_amount: amount });
    return serverError(res, error);
  }

  const { data: prof } = await supabase.from('profiles').select('nickname').eq('id', req.userId).single();
  sendTelegram(
    `💸 Заявка на вывод\nПользователь: @${prof?.nickname ?? req.userId}\n` +
    `Сумма: ${amount} ₽ (${SOURCE_LABEL[source]} баланс) на ${METHOD_LABEL[method]}: ${card_number}`
  );

  res.status(201).json(data);
});

const VIP_PLANS = { month: { priceKey: 'vip_price_month', daysKey: 'vip_duration_month_days' },
                    year:  { priceKey: 'vip_price_year',  daysKey: 'vip_duration_year_days'  } };

// Base prices/durations from admin_settings + the caller's level discount.
// purchase_vip trusts the p_price it's handed, so the discount is applied here
// (and only here) — never accept a price from the client.
async function vipPricing(userId) {
  const [{ data: settingsRows }, { data: prof }] = await Promise.all([
    supabase.from('admin_settings').select('key, value')
      .in('key', [...Object.values(VIP_PLANS).flatMap(p => [p.priceKey, p.daysKey]),
                  'vip_token_discount_pct', 'vip_level_discounts']),
    supabase.from('profiles').select('level').eq('id', userId).single(),
  ]);
  const settings = Object.fromEntries((settingsRows ?? []).map(r => [r.key, r.value]));
  // Таблица скидок по уровню — из настроек (admin_settings.vip_level_discounts),
  // без ключа действует прежнее правило. Считается здесь, на сервере: purchase_vip
  // доверяет переданной цене.
  const levelDiscounts = parseLevelDiscounts(settings.vip_level_discounts);
  const discountPercent = vipDiscountPct(prof?.level, levelDiscounts);
  const plans = {};
  for (const [name, p] of Object.entries(VIP_PLANS)) {
    const base = parseFloat(settings[p.priceKey]);
    const days = parseInt(settings[p.daysKey]);
    plans[name] = { base, days, price: applyVipDiscount(base, prof?.level, levelDiscounts) };
  }
  // same key routes/gost.js reads when discounting a token purchase
  const tokenDiscount = parseFloat(settings.vip_token_discount_pct);
  return { plans, discountPercent, gostTokenDiscountPercent: Number.isFinite(tokenDiscount) ? tokenDiscount : 0 };
}

// GET /wallet/vip/price — prices with the caller's level discount applied
router.get('/vip/price', async (req, res) => {
  const { plans, discountPercent, gostTokenDiscountPercent } = await vipPricing(req.userId);
  if (!Number.isFinite(plans.month.base) || !Number.isFinite(plans.year.base))
    return res.status(500).json({ error: 'VIP не настроен (admin_settings)' });
  res.json({
    monthPrice: plans.month.price,
    yearPrice: plans.year.price,
    monthBasePrice: plans.month.base,
    yearBasePrice: plans.year.base,
    monthDays: plans.month.days,
    yearDays: plans.year.days,
    discountPercent,
    gostTokenDiscountPercent,
  });
});

// POST /wallet/vip — buy/extend VIP (plan: 'month' | 'year')
router.post('/vip', isBanned, async (req, res) => {
  if (!VIP_PLANS[req.body.plan]) return res.status(400).json({ error: 'Некорректный план (month/year)' });

  const { plans } = await vipPricing(req.userId);
  const { price, days, base } = plans[req.body.plan];
  if (!Number.isFinite(base) || !Number.isFinite(days))
    return res.status(500).json({ error: 'VIP не настроен (admin_settings)' });

  // price may be 0 at level 10 — purchase_vip accepts p_price >= 0 and still
  // writes the vip_purchase transaction row, so free activation stays on ledger.
  const { data: rows, error: rpcErr } = await supabase
    .rpc('purchase_vip', { p_user_id: req.userId, p_days: days, p_price: price, p_plan: req.body.plan });
  if (rpcErr) return serverError(res, rpcErr, 'wallet:vip:rpc');
  const result = rows?.[0];
  if (!result?.success) return res.status(400).json({ error: 'Недостаточно средств на балансе' });

  res.json({ success: true, vip_expires_at: result.new_vip_expires_at });
});

module.exports = router;
