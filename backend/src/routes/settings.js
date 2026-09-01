const { Router } = require('express');
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();

// GET /settings/public/commissions — ставки, которые пользователь должен видеть
// до действия: комиссия за вывод занесённых денег, наценка биржи к цене заказа,
// и комиссия за пополнение через ParityPay (СБП). Остальной admin_settings
// остаётся админским.
router.get('/public/commissions', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('admin_settings')
    .select('key, value')
    .in('key', ['withdrawal_commission_pct', 'marketplace_commission_pct', 'paritypay_commission_pct']);

  if (error) return serverError(res, error);
  const num = (key, fallback) => {
    const pct = parseFloat((data ?? []).find(r => r.key === key)?.value);
    return Number.isFinite(pct) ? pct : fallback;
  };
  res.json({
    withdrawal_commission_pct: num('withdrawal_commission_pct', 15),
    marketplace_commission_pct: num('marketplace_commission_pct', 10),
    paritypay_commission_pct: num('paritypay_commission_pct', 1.8),
  });
});

// GET /settings/:key — any authenticated user
router.get('/:key', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('site_settings')
    .select('key, value, updated_by, updated_at')
    .eq('key', req.params.key)
    .maybeSingle();

  if (error) return serverError(res, error);

  // Return null value if row missing — frontend shows fallback
  res.json(data ?? { key: req.params.key, value: null, updated_by: null, updated_at: null });
});

module.exports = router;
