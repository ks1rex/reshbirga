const { Router } = require('express');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();

// GET /users/:id — public profile (no auth required)
router.get('/:id', async (req, res) => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url, rating_as_customer, reviews_count_customer, rating_as_executor, reviews_count_executor, created_at')
    .eq('id', req.params.id)
    .single();
  if (error || !profile) return res.status(404).json({ error: 'User not found' });
  res.json(profile);
});

// GET /users/:id/reviews?context=as_executor|as_customer&limit=20&offset=0
router.get('/:id/reviews', async (req, res) => {
  const { context, limit = 20, offset = 0 } = req.query;
  const lim = Math.min(Number(limit), 50);
  const off = Number(offset);

  let q = supabase
    .from('reviews')
    .select(`
      id, rating, comment, context, created_at,
      reviewer:profiles!reviews_reviewer_id_fkey(id, nickname),
      orders!inner(subject)
    `)
    .eq('reviewee_id', req.params.id)
    .order('created_at', { ascending: false })
    .range(off, off + lim - 1);

  if (context) q = q.eq('context', context);

  const { data, error } = await q;
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

module.exports = router;
