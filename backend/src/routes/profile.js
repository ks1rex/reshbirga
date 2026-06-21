const { Router } = require('express');
const auth    = require('../middleware/auth');
const isBanned = require('../middleware/isBanned');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');
const { nextLevelReputation } = require('../utils/reputation');

const router = Router();
router.use(auth);

const PUBLIC_FIELDS = `
  id, nickname, full_name, avatar_url, bio, is_verified, skills,
  level, reputation, forum_posts_count, deals_count,
  average_rating, reviews_count, created_at
`;

// GET /profile/leaderboard — top 10 by reputation
router.get('/leaderboard', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url, level, reputation, deals_count')
    .order('reputation', { ascending: false })
    .limit(10);
  if (error) return serverError(res, error);
  res.json({ users: data ?? [] });
});

// GET /profile/:id/public — public profile card
router.get('/:id/public', async (req, res) => {
  const { data: prof, error } = await supabase.from('profiles').select(PUBLIC_FIELDS).eq('id', req.params.id).single();
  if (error || !prof) return res.status(404).json({ error: 'Профиль не найден' });

  const [{ data: achievements }, { data: posts }, { data: deals }, { data: threads }] = await Promise.all([
    supabase.from('achievements').select('type, earned_at').eq('user_id', req.params.id).order('earned_at', { ascending: false }),
    supabase.from('forum_posts').select('content, created_at, thread_id, forum_threads(title)')
      .eq('author_id', req.params.id).order('created_at', { ascending: false }).limit(10),
    supabase.from('orders').select('final_amount, base_amount, completed_at')
      .eq('executor_id', req.params.id).eq('status', 'completed').order('completed_at', { ascending: false }).limit(10),
    supabase.from('forum_threads').select('title, created_at')
      .eq('author_id', req.params.id).order('created_at', { ascending: false }).limit(10),
  ]);

  const recent_activity = [
    ...(posts ?? []).map(p => ({ type: 'post', text: p.content?.slice(0, 200) ?? '', forum_category: p.forum_threads?.title ?? null, ago: p.created_at })),
    ...(deals ?? []).map(d => ({ type: 'deal', amount: parseFloat(d.final_amount ?? d.base_amount ?? 0), ago: d.completed_at })),
    ...(threads ?? []).map(t => ({ type: 'thread', title: t.title, ago: t.created_at })),
  ].sort((a, b) => new Date(b.ago) - new Date(a.ago)).slice(0, 10);

  res.json({
    ...prof,
    next_level_reputation: nextLevelReputation(prof.reputation),
    achievements: achievements ?? [],
    recent_activity,
  });
});

// GET /profile/:id/reviews
router.get('/:id/reviews', async (req, res) => {
  const { data: reviews, error } = await supabase
    .from('reviews')
    .select('rating, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(id, nickname, avatar_url)')
    .eq('reviewee_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return serverError(res, error);
  res.json({
    reviews: (reviews ?? []).map(r => ({
      author_id: r.reviewer?.id, author_username: r.reviewer?.nickname, author_avatar: r.reviewer?.avatar_url,
      rating: r.rating, text: r.comment, created_at: r.created_at,
    })),
  });
});

// GET /profile/:id/services — active listings owned by this user
router.get('/:id/services', async (req, res) => {
  const { data, error } = await supabase
    .from('listings')
    .select('id, title, description, price, category, created_at')
    .eq('owner_id', req.params.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// Fields a user is allowed to update via this endpoint.
// Sensitive fields (balance, is_admin, token_balance, has_access, is_banned, etc.)
// are deliberately excluded — only the backend service_role can change those.
const EDITABLE_FIELDS = [
  'full_name',
  'phone',
  'telegram_username',
  'university_group',
  'avatar_url',
  'nickname',
  'bio',
  'skills',
];

// GET /profile — own full profile
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      id, email, nickname, full_name, avatar_url,
      phone, telegram_username, university_group,
      balance, token_balance, is_admin, has_access,
      referral_code, referral_earnings,
      referral_registered_count, referral_qualifying_deposits_count,
      rating_as_customer, rating_as_executor,
      reviews_count_customer, reviews_count_executor,
      bio, is_verified, skills, level, reputation,
      forum_posts_count, deals_count, average_rating, reviews_count,
      is_banned, created_at, updated_at
    `)
    .eq('id', req.userId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Профиль не найден' });
  res.json({ ...data, next_level_reputation: nextLevelReputation(data.reputation ?? 0) });
});

// PUT /profile — update own editable fields
router.put('/', isBanned, async (req, res) => {
  const patch = {};

  for (const key of EDITABLE_FIELDS) {
    if (!(key in req.body)) continue;
    const val = req.body[key];
    // Coerce empty string to null so the DB stores NULL, not an empty string
    patch[key] = (typeof val === 'string' && val.trim() === '') ? null : val;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Нет допустимых полей для обновления' });
  }

  // Basic validation
  if (patch.phone !== undefined && patch.phone !== null) {
    const digits = String(patch.phone).replace(/\D/g, '');
    if (digits.length !== 11 || (!digits.startsWith('7') && !digits.startsWith('8'))) {
      return res.status(400).json({ error: 'Некорректный формат телефона' });
    }
  }

  if (patch.telegram_username !== undefined && patch.telegram_username !== null) {
    if (!String(patch.telegram_username).startsWith('@')) {
      return res.status(400).json({ error: 'Telegram username должен начинаться с @' });
    }
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', req.userId)
    .select(`
      id, email, nickname, full_name, avatar_url,
      phone, telegram_username, university_group,
      balance, token_balance, is_admin, has_access,
      referral_code, referral_earnings,
      rating_as_customer, rating_as_executor,
      updated_at
    `)
    .single();

  if (error) return serverError(res, error, 'profile:update');
  res.json(data);
});

module.exports = router;
