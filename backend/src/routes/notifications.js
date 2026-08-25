const { Router } = require('express');
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();
router.use(auth);

// GET /notifications?limit=20 — newest first
router.get('/', async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, is_read, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// GET /notifications/unread-count
router.get('/unread-count', async (req, res) => {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.userId)
    .eq('is_read', false);
  if (error) return serverError(res, error);
  res.json({ count: count ?? 0 });
});

// PATCH /notifications/read-all
router.patch('/read-all', async (req, res) => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', req.userId)
    .eq('is_read', false);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', req.params.id)
    .eq('user_id', req.userId);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

module.exports = router;
