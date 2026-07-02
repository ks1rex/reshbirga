const { Router } = require('express');
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();

// GET /settings/public/withdrawal-commission-pct — the one admin_settings value
// users need to see before submitting a withdrawal (rest of admin_settings stays admin-only).
router.get('/public/withdrawal-commission-pct', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', 'withdrawal_commission_pct')
    .maybeSingle();

  if (error) return serverError(res, error);
  const pct = parseFloat(data?.value);
  res.json({ withdrawal_commission_pct: Number.isFinite(pct) ? pct : 10 });
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
