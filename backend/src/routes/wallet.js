const { Router } = require('express');
const auth = require('../middleware/auth');
const isBanned = require('../middleware/isBanned');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();
router.use(auth);

// GET /wallet — balance + last 5 of each request type
router.get('/', async (req, res) => {
  const [profileRes, depositsRes, withdrawalsRes] = await Promise.all([
    supabase.from('profiles').select('balance').eq('id', req.userId).single(),
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
  res.json({
    balance: parseFloat(profileRes.data?.balance ?? 0),
    recent_deposits: depositsRes.data ?? [],
    recent_withdrawals: withdrawalsRes.data ?? [],
  });
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

module.exports = router;
