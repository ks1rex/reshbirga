const { Router } = require('express');
const auth    = require('../middleware/auth');
const isBanned = require('../middleware/isBanned');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');
const { nextLevelReputation } = require('../utils/reputation');
const { isVip } = require('../utils/vip');
const { marketplaceCommissionPct, chargeWithCommission } = require('../utils/commission');

const router = Router();
router.use(auth);

// Nickname doubles as the profile URL slug — url-safe only, and must not
// look like a UUID (so the id-or-nickname lookup below can't be tricked
// into resolving someone else's id).
const NICKNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /profile/:idOrNickname/public and friends accept either a UUID id or
// a nickname, so a user's chosen nickname works as their profile link.
function idOrNicknameFilter(query, param) {
  return UUID_RE.test(param) ? query.eq('id', param) : query.eq('nickname', param);
}

const PUBLIC_FIELDS = `
  id, nickname, full_name, avatar_url, bio, skills,
  level, reputation, forum_posts_count, deals_count,
  average_rating, reviews_count, created_at, vip_expires_at
`;

// GET /profile/leaderboard — top 10 by reputation gained in the last 7 days
router.get('/leaderboard', async (req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: logs, error: logErr } = await supabase
    .from('reputation_log')
    .select('user_id, amount')
    .gte('created_at', since);
  if (logErr) return serverError(res, logErr);

  const weekly = {};
  for (const l of logs ?? []) weekly[l.user_id] = (weekly[l.user_id] ?? 0) + l.amount;

  const topIds = Object.entries(weekly).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id]) => id);
  if (topIds.length === 0) return res.json({ users: [] });

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, nickname, avatar_url, level, reputation, deals_count, is_admin')
    .in('id', topIds)
    .eq('is_admin', false);
  if (error) return serverError(res, error);

  const users = profiles
    .map(({ is_admin, ...p }) => ({ ...p, weekly_reputation: weekly[p.id] ?? 0 }))
    .sort((a, b) => b.weekly_reputation - a.weekly_reputation)
    .slice(0, 10);

  res.json({ users });
});

// GET /profile/:id/public — public profile card (id or nickname)
router.get('/:id/public', async (req, res) => {
  const { data: prof, error } = await idOrNicknameFilter(supabase.from('profiles').select(PUBLIC_FIELDS), req.params.id).single();
  if (error || !prof) return res.status(404).json({ error: 'Профиль не найден' });
  const userId = prof.id;

  const [{ data: achievements }, { data: posts }, { data: deals }, { data: threads }] = await Promise.all([
    supabase.from('achievements').select('type, earned_at').eq('user_id', userId).order('earned_at', { ascending: false }),
    supabase.from('forum_posts').select('content, created_at, thread_id, forum_threads(title)')
      .eq('author_id', userId).order('created_at', { ascending: false }).limit(10),
    supabase.from('orders').select('final_amount, base_amount, completed_at')
      .eq('executor_id', userId).eq('status', 'completed').order('completed_at', { ascending: false }).limit(10),
    supabase.from('forum_threads').select('title, created_at')
      .eq('author_id', userId).order('created_at', { ascending: false }).limit(10),
  ]);

  const recent_activity = [
    ...(posts ?? []).map(p => ({ type: 'post', text: p.content?.slice(0, 200) ?? '', forum_category: p.forum_threads?.title ?? null, ago: p.created_at })),
    ...(deals ?? []).map(d => ({ type: 'deal', amount: parseFloat(d.final_amount ?? d.base_amount ?? 0), ago: d.completed_at })),
    ...(threads ?? []).map(t => ({ type: 'thread', title: t.title, ago: t.created_at })),
  ].sort((a, b) => new Date(b.ago) - new Date(a.ago)).slice(0, 10);

  const { vip_expires_at, ...profRest } = prof;
  res.json({
    ...profRest,
    is_vip: isVip(vip_expires_at),
    next_level_reputation: nextLevelReputation(prof.reputation),
    achievements: achievements ?? [],
    recent_activity,
  });
});

// GET /profile/:id/reviews
router.get('/:id/reviews', async (req, res) => {
  const { data: target, error: targetErr } = await idOrNicknameFilter(supabase.from('profiles').select('id'), req.params.id).single();
  if (targetErr || !target) return res.status(404).json({ error: 'Профиль не найден' });

  const { data: reviews, error } = await supabase
    .from('reviews')
    .select('rating, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(id, nickname, avatar_url)')
    .eq('reviewee_id', target.id)
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
  const { data: target, error: targetErr } = await idOrNicknameFilter(supabase.from('profiles').select('id'), req.params.id).single();
  if (targetErr || !target) return res.status(404).json({ error: 'Профиль не найден' });

  const { data, error } = await supabase
    .from('listings')
    .select('id, title, description, price, category, created_at')
    .eq('owner_id', target.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) return serverError(res, error);
  // Как и в каталоге услуг: посетитель видит цену с комиссией биржи —
  // ту, что спишется при заказе (listings.price — доля исполнителя).
  const pct = await marketplaceCommissionPct();
  res.json((data ?? []).map(l => ({
    ...l,
    price_with_commission: chargeWithCommission(parseFloat(l.price ?? 0), pct),
    commission_pct: pct,
  })));
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
      bio, skills, level, reputation,
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

  if (patch.nickname !== undefined && patch.nickname !== null) {
    if (!NICKNAME_RE.test(patch.nickname) || UUID_RE.test(patch.nickname)) {
      return res.status(400).json({ error: 'Никнейм: 3-32 символа, латиница/цифры/-/_' });
    }
    const { data: taken } = await supabase
      .from('profiles')
      .select('id')
      .ilike('nickname', patch.nickname.replace(/[%_]/g, '\\$&')) // escape ilike wildcards (nickname can contain _)
      .neq('id', req.userId)
      .maybeSingle();
    if (taken) return res.status(409).json({ error: 'Этот никнейм уже занят' });
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

  if (error) {
    // Race with a concurrent update to the same nickname — DB unique index is the real guard.
    if (error.code === '23505') return res.status(409).json({ error: 'Этот никнейм уже занят' });
    return serverError(res, error, 'profile:update');
  }
  res.json(data);
});

// POST /profile/view-as-admin — self-service toggle for the "смотреть как
// админ" demo mode. Not a UI-only flag: really flips is_owner, so owner-only
// routes genuinely 403 while toggled (see migration
// 20260820130000_add_owner_was.sql for is_owner_was's role).
//
// No target state accepted from the client — always re-derives from the
// freshly read DB row (is_owner/is_owner_was), so a stale/tampered client
// can't force either direction:
//   is_owner=true  -> flips to false (is_owner_was untouched)
//   is_owner=false && is_owner_was=true -> restores to true
//   otherwise (never granted owner) -> 403
router.post('/view-as-admin', async (req, res) => {
  const { data: profile, error: fetchErr } = await supabase
    .from('profiles')
    .select('is_owner, is_owner_was')
    .eq('id', req.userId)
    .single();
  if (fetchErr || !profile) return res.status(404).json({ error: 'Профиль не найден' });

  let nextIsOwner;
  if (profile.is_owner) {
    nextIsOwner = false;
  } else if (profile.is_owner_was) {
    nextIsOwner = true;
  } else {
    return res.status(403).json({ error: 'Недоступно' });
  }

  const { error } = await supabase.from('profiles').update({ is_owner: nextIsOwner }).eq('id', req.userId);
  if (error) return serverError(res, error, 'profile:view-as-admin');

  res.json({ is_owner: nextIsOwner });
});

module.exports = router;
