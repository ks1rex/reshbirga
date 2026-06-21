const { Router } = require('express');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();

// GET /stats/public — homepage counters, no auth required
router.get('/public', async (req, res) => {
  const [{ count: users_count, error: e1 }, { count: threads_count, error: e2 }, { count: orders_count, error: e3 }, { data: payouts, error: e4 }, { count: posts_count, error: e5 }] =
    await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('forum_threads').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      supabase.from('transactions').select('amount').eq('type', 'order_payout').eq('status', 'completed'),
      supabase.from('forum_posts').select('id', { count: 'exact', head: true }),
    ]);
  const error = e1 || e2 || e3 || e4 || e5;
  if (error) return serverError(res, error, 'stats:public');

  const total_paid = (payouts ?? []).reduce((sum, t) => sum + parseFloat(t.amount ?? 0), 0);

  res.json({
    users_count: users_count ?? 0,
    threads_count: threads_count ?? 0,
    orders_count: orders_count ?? 0,
    posts_count: posts_count ?? 0,
    total_paid,
  });
});

module.exports = router;
