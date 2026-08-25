const { Router } = require('express');
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();

// GET /news — публично, новые сверху
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('news')
    .select('id, title, content, created_at, updated_at, author:profiles!news_author_id_fkey(nickname)')
    .order('created_at', { ascending: false });
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// POST /news — админ
router.post('/', auth, async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  if (!profile?.is_admin) return res.status(403).json({ error: 'Admin only' });

  const { title, content } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  if (title.length > 200) return res.status(400).json({ error: 'Заголовок слишком длинный' });
  if (content.length > 20000) return res.status(400).json({ error: 'Текст слишком длинный' });

  const { data, error } = await supabase
    .from('news')
    .insert({ title: title.trim(), content: content.trim(), author_id: req.userId })
    .select()
    .single();
  if (error) return serverError(res, error);
  res.status(201).json(data);
});

// PATCH /news/:id — админ
router.patch('/:id', auth, async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  if (!profile?.is_admin) return res.status(403).json({ error: 'Admin only' });

  const { title, content } = req.body;
  const patch = { updated_at: new Date().toISOString() };
  if (title !== undefined) {
    if (!title.trim()) return res.status(400).json({ error: 'title is required' });
    patch.title = title.trim();
  }
  if (content !== undefined) {
    if (!content.trim()) return res.status(400).json({ error: 'content is required' });
    patch.content = content.trim();
  }

  const { data, error } = await supabase
    .from('news')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return serverError(res, error);
  res.json(data);
});

// DELETE /news/:id — админ
router.delete('/:id', auth, async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  if (!profile?.is_admin) return res.status(403).json({ error: 'Admin only' });

  const { error } = await supabase.from('news').delete().eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

module.exports = router;
