const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');

const GOST_URL = process.env.GOST_BACKEND_URL;

// GET /gost/token-balance
router.get('/token-balance', auth, async (req, res) => {
  try {
    const [profileRes, settingRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('token_balance, unlimited_access')
        .eq('id', req.userId)
        .single(),
      supabase
        .from('admin_settings')
        .select('value')
        .eq('key', 'gost_token_price')
        .single(),
    ]);
    if (profileRes.error) throw profileRes.error;
    const profile = profileRes.data;
    res.json({
      token_balance:    profile.token_balance    ?? 0,
      unlimited_access: profile.unlimited_access ?? false,
      token_price:      parseFloat(settingRes.data?.value ?? '10'),
    });
  } catch (err) {
    console.error('[gost/token-balance]', err);
    res.status(500).json({ error: 'Не удалось получить баланс токенов' });
  }
});

// POST /gost/buy-tokens  { token_amount: number }
router.post('/buy-tokens', auth, async (req, res) => {
  const { token_amount } = req.body;
  if (!token_amount || !Number.isInteger(token_amount) || token_amount < 1) {
    return res.status(400).json({ error: 'Укажите целое количество токенов (≥ 1)' });
  }

  try {
    const [{ data: settings }, { data: profileVip }] = await Promise.all([
      supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', ['gost_token_price', 'vip_token_discount_pct']),
      supabase
        .from('profiles')
        .select('vip_expires_at')
        .eq('id', req.userId)
        .single(),
    ]);
    const num = (key, fallback) =>
      parseFloat(settings?.find((s) => s.key === key)?.value ?? fallback);
    const tokenPrice = num('gost_token_price', '10');
    const isVip = !!profileVip?.vip_expires_at && new Date(profileVip.vip_expires_at) > new Date();
    const discountPct = isVip ? num('vip_token_discount_pct', '0') : 0;
    const baseCost = token_amount * tokenPrice;
    const cost = Math.round(baseCost * (1 - discountPct / 100) * 100) / 100;
    const meta = isVip && discountPct > 0
      ? { vip_discount_applied: true, discount_pct: discountPct, base_price: baseCost, token_price: tokenPrice }
      : { vip_discount_applied: false };

    const { error: rpcError } = await supabase.rpc('buy_gost_tokens', {
      p_user_id:     req.userId,
      p_token_amount: token_amount,
      p_rub_cost:    cost,
      p_meta:        meta,
    });

    if (rpcError) {
      if (rpcError.message?.includes('insufficient_balance')) {
        return res.status(400).json({ error: 'Недостаточно средств на балансе' });
      }
      throw rpcError;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('balance, token_balance')
      .eq('id', req.userId)
      .single();

    // gost_master achievement is granted on actual document generation
    // (counted in the GOST backend's /generate), not on token purchase.

    res.json({
      token_balance: profile.token_balance,
      balance:       profile.balance,
      cost,
    });
  } catch (err) {
    console.error('[gost/buy-tokens]', err);
    res.status(500).json({ error: 'Ошибка при покупке токенов' });
  }
});

// POST /gost/activate-key  { code: string }
// Proxies to the GOST Python backend's /redeem-code
router.post('/activate-key', auth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Укажите код активации' });

  if (!GOST_URL) {
    return res.status(503).json({ error: 'ГОСТ-сервис недоступен (не задан GOST_BACKEND_URL)' });
  }

  try {
    const response = await fetch(`${GOST_URL}/redeem-code`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   req.headers.authorization,
      },
      body: JSON.stringify({ code }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[gost/activate-key]', err);
    res.status(500).json({ error: 'Ошибка при активации кода' });
  }
});

module.exports = router;
