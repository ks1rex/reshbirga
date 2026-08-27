const { Router } = require('express');
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();

// Владельческая фича (см. CLAUDE.md "Два admin-тира"): рядовой админ видит
// раздел в UI, но управлять списком преподавателей может только владелец.
async function requireOwner(req, res) {
  const { data: profile } = await supabase.from('profiles').select('is_admin, is_owner').eq('id', req.userId).single();
  if (!profile?.is_admin || !profile?.is_owner) { res.status(403).json({ error: 'Требуются права владельца' }); return false; }
  return true;
}

async function withStats(teachers) {
  if (!teachers.length) return [];
  const { data: stats } = await supabase
    .from('teacher_stats')
    .select('teacher_id, avg_rating, reviews_count')
    .in('teacher_id', teachers.map(t => t.id));
  const map = {};
  for (const s of stats ?? []) map[s.teacher_id] = s;
  return teachers.map(t => ({
    ...t,
    avg_rating: map[t.id]?.avg_rating ?? null,
    reviews_count: map[t.id]?.reviews_count ?? 0,
  }));
}

// GET /teachers — публично, со статистикой рейтинга
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('teachers').select('*').order('full_name');
  if (error) return serverError(res, error);
  res.json(await withStats(data ?? []));
});

// GET /teachers/:id — публично, + свой отзыв, если авторизован
router.get('/:id', async (req, res) => {
  const { data: teacher, error } = await supabase.from('teachers').select('*').eq('id', req.params.id).single();
  if (error || !teacher) return res.status(404).json({ error: 'Не найден' });
  const [withAgg] = await withStats([teacher]);

  const { data: reviews } = await supabase
    .from('teacher_reviews')
    .select('id, rating, comment, created_at, updated_at, user:profiles!teacher_reviews_user_id_fkey(id, nickname, avatar_url)')
    .eq('teacher_id', req.params.id)
    .order('created_at', { ascending: false });

  let myReview = null;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const { data: { user } } = await supabase.auth.getUser(header.split(' ')[1]).catch(() => ({ data: {} }));
    if (user) myReview = (reviews ?? []).find(r => r.user.id === user.id) ?? null;
  }

  res.json({ ...withAgg, reviews: reviews ?? [], my_review: myReview });
});

// POST /teachers — владелец
router.post('/', auth, async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const { full_name, position, photo_url } = req.body;
  if (!full_name?.trim()) return res.status(400).json({ error: 'full_name is required' });

  const { data, error } = await supabase
    .from('teachers')
    .insert({
      full_name: full_name.trim(),
      position: position?.trim() || null,
      photo_url: photo_url?.trim() || null,
    })
    .select()
    .single();
  if (error) return serverError(res, error);
  res.status(201).json(data);
});

// PATCH /teachers/:id — владелец
router.patch('/:id', auth, async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const { full_name, position, photo_url } = req.body;
  const patch = {};
  if (full_name !== undefined) {
    if (!full_name.trim()) return res.status(400).json({ error: 'full_name is required' });
    patch.full_name = full_name.trim();
  }
  if (position !== undefined) patch.position = position?.trim() || null;
  if (photo_url !== undefined) patch.photo_url = photo_url?.trim() || null;

  const { data, error } = await supabase.from('teachers').update(patch).eq('id', req.params.id).select().single();
  if (error) return serverError(res, error);
  res.json(data);
});

// DELETE /teachers/:id — владелец
router.delete('/:id', auth, async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const { error } = await supabase.from('teachers').delete().eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// POST /teachers/:id/reviews — свой отзыв, upsert (создать или отредактировать)
router.post('/:id/reviews', auth, async (req, res) => {
  const { rating, comment } = req.body;
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return res.status(400).json({ error: 'rating должен быть от 1 до 5' });
  if (comment && comment.length > 3000) return res.status(400).json({ error: 'Отзыв слишком длинный' });

  const { data: teacher } = await supabase.from('teachers').select('id').eq('id', req.params.id).single();
  if (!teacher) return res.status(404).json({ error: 'Не найден' });

  const { data, error } = await supabase
    .from('teacher_reviews')
    .upsert(
      { teacher_id: req.params.id, user_id: req.userId, rating: r, comment: comment?.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: 'teacher_id,user_id' }
    )
    .select()
    .single();
  if (error) return serverError(res, error);
  res.status(201).json(data);
});

// DELETE /teachers/:id/reviews — удалить свой отзыв
router.delete('/:id/reviews', auth, async (req, res) => {
  const { error } = await supabase
    .from('teacher_reviews')
    .delete()
    .eq('teacher_id', req.params.id)
    .eq('user_id', req.userId);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// DELETE /teachers/reviews/:reviewId — модерация, любой отзыв, только владелец
router.delete('/reviews/:reviewId', auth, async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const { error } = await supabase.from('teacher_reviews').delete().eq('id', req.params.reviewId);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

module.exports = router;
