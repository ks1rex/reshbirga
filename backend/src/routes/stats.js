const { Router } = require('express');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();

// GET /stats/marketplace — feed counters for both Биржа tabs at once, so the
// UI can show both without loading the inactive tab's list. head:true → COUNT
// only, none of the joins the /orders and /listings feeds do.
router.get('/marketplace', async (req, res) => {
  const [{ count: orders_count, error: e1 }, { count: listings_count, error: e2 }] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'open').eq('is_hidden', false),
    supabase.from('listings').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);
  if (e1 || e2) return serverError(res, e1 || e2, 'stats:marketplace');
  res.json({ orders_count: orders_count ?? 0, listings_count: listings_count ?? 0 });
});

// GET /stats/public — homepage counters, no auth required
router.get('/public', async (req, res) => {
  const [{ count: users_count, error: e1 }, { count: threads_count, error: e2 }, { count: orders_count, error: e3 }, { data: payouts, error: e4 }, { count: posts_count, error: e5 }, { data: override, error: e6 }] =
    await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('forum_threads').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      supabase.from('transactions').select('amount').eq('type', 'order_payout').eq('status', 'completed'),
      supabase.from('forum_posts').select('id', { count: 'exact', head: true }),
      supabase.from('admin_settings').select('value').eq('key', 'homepage_users_count_override').maybeSingle(),
    ]);
  const error = e1 || e2 || e3 || e4 || e5 || e6;
  if (error) return serverError(res, error, 'stats:public');

  const total_paid = (payouts ?? []).reduce((sum, t) => sum + parseFloat(t.amount ?? 0), 0);
  const overrideValue = override?.value?.trim();
  const displayedUsersCount = overrideValue ? parseInt(overrideValue, 10) : (users_count ?? 0);

  res.json({
    users_count: displayedUsersCount,
    threads_count: threads_count ?? 0,
    orders_count: orders_count ?? 0,
    posts_count: posts_count ?? 0,
    total_paid,
  });
});

module.exports = router;
