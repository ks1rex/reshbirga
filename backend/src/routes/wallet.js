const { Router } = require('express');
const auth = require('../middleware/auth');
const isBanned = require('../middleware/isBanned');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();
router.use(auth);

// GET /wallet — balance + last 5 of each request type + referral info
router.get('/', async (req, res) => {
  const [profileRes, depositsRes, withdrawalsRes] = await Promise.all([
    supabase.from('profiles')
      .select('balance, referral_code, referral_earnings, referral_registered_count, vip_expires_at')
      .eq('id', req.userId).single(),
    supabase.from('deposit_requests')
      .select('id, claimed_amount, confirmed_amount, credited_amount, status, admin_comment, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('withdrawal_requests')
      .select('id, amount, card_number, status, admin_comment, created_at')
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
const OUTCOME_TYPES = ['withdrawal', 'gost_tokens'];

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
    .select('id, amount, card_number, status, admin_comment, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// POST /wallet/withdrawals — create withdrawal request (deducts balance as reserve)
router.post('/withdrawals', isBanned, async (req, res) => {
  const amount = parseFloat(req.body.amount);
  const card_number = req.body.card_number?.trim();

  if (!amount || amount <= 0 || isNaN(amount))
    return res.status(400).json({ error: 'Укажите сумму больше 0' });
  if (!card_number)
    return res.status(400).json({ error: 'Укажите номер карты' });
  if (card_number.length > 100)
    return res.status(400).json({ error: 'Номер карты слишком длинный' });

  // Atomic deduct — fails if balance insufficient
  const { data: ok, error: rpcErr } = await supabase
    .rpc('try_subtract_wallet_balance', { p_user_id: req.userId, p_amount: amount });

  if (rpcErr) return serverError(res, rpcErr, 'wallet:withdraw:rpc');
  if (!ok) return res.status(400).json({ error: 'Недостаточно средств на балансе' });

  const { data, error } = await supabase
    .from('withdrawal_requests')
    .insert({ user_id: req.userId, amount, card_number, status: 'pending' })
    .select()
    .single();

  if (error) {
    // Roll back the balance deduction
    await supabase.rpc('add_wallet_balance', { p_user_id: req.userId, p_amount: amount });
    return serverError(res, error);
  }
  res.status(201).json(data);
});

const VIP_PLANS = { month: { priceKey: 'vip_price_month', daysKey: 'vip_duration_month_days' },
                    year:  { priceKey: 'vip_price_year',  daysKey: 'vip_duration_year_days'  } };

// POST /wallet/vip — buy/extend VIP (plan: 'month' | 'year')
router.post('/vip', isBanned, async (req, res) => {
  const plan = VIP_PLANS[req.body.plan];
  if (!plan) return res.status(400).json({ error: 'Некорректный план (month/year)' });

  const { data: settingsRows } = await supabase
    .from('admin_settings')
    .select('key, value')
    .in('key', [plan.priceKey, plan.daysKey]);
  const settings = Object.fromEntries((settingsRows ?? []).map(r => [r.key, r.value]));
  const price = parseFloat(settings[plan.priceKey]);
  const days  = parseInt(settings[plan.daysKey]);
  if (!Number.isFinite(price) || !Number.isFinite(days))
    return res.status(500).json({ error: 'VIP не настроен (admin_settings)' });

  const { data: rows, error: rpcErr } = await supabase
    .rpc('purchase_vip', { p_user_id: req.userId, p_days: days, p_price: price, p_plan: req.body.plan });
  if (rpcErr) return serverError(res, rpcErr, 'wallet:vip:rpc');
  const result = rows?.[0];
  if (!result?.success) return res.status(400).json({ error: 'Недостаточно средств на балансе' });

  res.json({ success: true, vip_expires_at: result.vip_expires_at });
});

module.exports = router;
