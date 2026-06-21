const { Router } = require('express');
const auth     = require('../middleware/auth');
const isBanned = require('../middleware/isBanned');
const supabase = require('../supabase_client');
const { moderateSync } = require('../utils/forumModerator');
const { serverError }  = require('../utils/httpError');
const { addReputation, grantAchievement } = require('../utils/reputation');

const router   = Router();
const PAGE_SIZE = 20;

// ── Optional auth (sets req.userId if token valid, doesn't reject anon) ──────
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const token = header.split(' ')[1];
  const { data: { user } } = await supabase.auth.getUser(token).catch(() => ({ data: {} }));
  req.user   = user ?? null;
  req.userId = user?.id ?? null;
  next();
}

async function requireAdmin(req, res, next) {
  const { data } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  if (!data?.is_admin) return res.status(403).json({ error: 'Только для администраторов' });
  next();
}

// +1 forum_posts_count, grants first_post/posts_50/posts_200 at the right counts
async function bumpForumPostsCount(userId) {
  const { data: prof } = await supabase.from('profiles').select('forum_posts_count').eq('id', userId).single();
  const count = (prof?.forum_posts_count ?? 0) + 1;
  await supabase.from('profiles').update({ forum_posts_count: count }).eq('id', userId);
  if (count === 1)   await grantAchievement(supabase, userId, 'first_post');
  if (count === 50)  await grantAchievement(supabase, userId, 'posts_50');
  if (count === 200) await grantAchievement(supabase, userId, 'posts_200');
}

// ── GET /forum/categories ─────────────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  const { data: cats, error } = await supabase
    .from('forum_categories')
    .select('*')
    .order('sort_order');
  if (error) return serverError(res, error, 'forum:categories');

  // Augment with thread count + last 2 threads (preview list; last_thread
  // kept as recent[0] for backward compat with existing frontend callers)
  const result = await Promise.all(cats.map(async (cat) => {
    const [{ count }, { data: recent }] = await Promise.all([
      supabase.from('forum_threads').select('id', { count: 'exact', head: true }).eq('category_id', cat.id),
      supabase.from('forum_threads')
        .select('id, title, last_post_at, last_post_author:profiles!forum_threads_last_post_author_id_fkey(nickname, avatar_url)')
        .eq('category_id', cat.id)
        .order('last_post_at', { ascending: false, nullsFirst: false })
        .limit(2),
    ]);
    return { ...cat, threads_count: count ?? 0, recent_threads: recent ?? [], last_thread: recent?.[0] ?? null };
  }));

  res.json(result);
});

// ── GET /forum/threads — global list across categories (home page, hot threads) ──
// ?sort=activity|date|top  ?limit=N (default 10, max 50)
router.get('/threads', async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '10', 10)));
  const sort  = req.query.sort ?? 'activity';
  const AUTHOR   = 'author:profiles!forum_threads_author_id_fkey(id, nickname, avatar_url)';
  const CATEGORY = 'category:forum_categories(id, name, icon_name)';

  let q = supabase
    .from('forum_threads')
    .select(`id, title, posts_count, views_count, created_at, last_post_at, ${AUTHOR}, ${CATEGORY}`);

  if (sort === 'date')      q = q.order('created_at', { ascending: false });
  else if (sort === 'top')  q = q.order('views_count', { ascending: false });
  else                      q = q.order('last_post_at', { ascending: false, nullsFirst: false });

  const { data, error } = await q.limit(limit);
  if (error) return serverError(res, error, 'forum:threads-global');
  res.json(data ?? []);
});

// ── GET /forum/trending-tags ──────────────────────────────────────────────────
// forum_threads/forum_posts have no tags column yet — static popular set until
// tagging ships. Swap for a real aggregation once a tags column exists.
router.get('/trending-tags', async (req, res) => {
  res.json({ tags: ['термех', 'сессия2026', 'газпромнефть', 'общага', 'курсач', 'стипуха', 'форум', 'губкин'] });
});

// ── GET /forum/categories/:id/threads ────────────────────────────────────────
router.get('/categories/:id/threads', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page ?? '1', 10));
  const sort  = req.query.sort ?? 'activity';
  const offset = (page - 1) * PAGE_SIZE;

  const AUTHOR = 'author:profiles!forum_threads_author_id_fkey(id, nickname, avatar_url)';
  const LAST   = 'last_post_author:profiles!forum_threads_last_post_author_id_fkey(id, nickname, avatar_url)';

  let q = supabase
    .from('forum_threads')
    .select(`id, title, is_pinned, is_locked, views_count, posts_count, last_post_at, created_at, ${AUTHOR}, ${LAST}`)
    .eq('category_id', req.params.id);

  if (sort === 'date')     q = q.order('is_pinned', { ascending: false }).order('created_at',   { ascending: false });
  else if (sort === 'popular') q = q.order('is_pinned', { ascending: false }).order('views_count', { ascending: false });
  else                     q = q.order('is_pinned', { ascending: false }).order('last_post_at', { ascending: false, nullsFirst: false });

  const { data: threads, error } = await q.range(offset, offset + PAGE_SIZE - 1);
  if (error) return serverError(res, error, 'forum:threads');

  // Category info for breadcrumb
  const { data: category } = await supabase.from('forum_categories').select('id, name, icon_name').eq('id', req.params.id).single();

  res.json({ category, threads: threads ?? [], page, has_more: (threads?.length ?? 0) === PAGE_SIZE });
});

// ── GET /forum/threads/:id ────────────────────────────────────────────────────
router.get('/threads/:id', async (req, res) => {
  const { data: thread, error } = await supabase
    .from('forum_threads')
    .select(`*, author:profiles!forum_threads_author_id_fkey(id, nickname, avatar_url), category:forum_categories(id, name, icon_name)`)
    .eq('id', req.params.id)
    .single();
  if (error || !thread) return res.status(404).json({ error: 'Тема не найдена' });
  res.json(thread);
});

// ── POST /forum/threads ───────────────────────────────────────────────────────
router.post('/threads', auth, isBanned, async (req, res) => {
  const { category_id, title, content } = req.body;
  if (!category_id || !title?.trim() || !content?.trim()) {
    return res.status(400).json({ error: 'Укажите категорию, заголовок и текст' });
  }
  if (title.trim().length > 200) return res.status(400).json({ error: 'Заголовок не более 200 символов' });
  if (content.trim().length > 10000) return res.status(400).json({ error: 'Текст не более 10 000 символов' });

  const mod = await moderateSync(content, req.userId);
  if (mod.blocked) {
    const msgs = { extremism: 'Пост содержит запрещённый контент', advertising: 'Пост содержит рекламу', spam: 'Пост определён как спам' };
    return res.status(422).json({ error: msgs[mod.reason] ?? 'Пост не прошёл модерацию' });
  }

  // Create thread + first post in a single batch
  const { data: thread, error: te } = await supabase
    .from('forum_threads')
    .insert({ category_id, author_id: req.userId, title: title.trim() })
    .select('id')
    .single();
  if (te) return serverError(res, te, 'forum:create-thread');

  const { error: pe } = await supabase.from('forum_posts').insert({
    thread_id:         thread.id,
    author_id:         req.userId,
    content:           content.trim(),
    moderation_status: process.env.DEEPSEEK_API_KEY ? 'pending_review' : 'approved',
  });
  if (pe) return serverError(res, pe, 'forum:create-first-post');

  await addReputation(supabase, req.userId, 5);
  await bumpForumPostsCount(req.userId);

  res.status(201).json({ thread_id: thread.id });
});

// ── POST /forum/threads/:id/view ─────────────────────────────────────────────
router.post('/threads/:id/view', async (req, res) => {
  await supabase.rpc('increment_thread_views', { thread_id: req.params.id }).catch(() => {
    // Fallback if RPC doesn't exist
    supabase.from('forum_threads').select('views_count').eq('id', req.params.id).single()
      .then(({ data }) => {
        if (data) supabase.from('forum_threads').update({ views_count: data.views_count + 1 }).eq('id', req.params.id);
      });
  });
  res.status(204).end();

  // Author rep bonuses / achievements at view milestones (fire-and-forget, after response)
  const { data: thread } = await supabase.from('forum_threads')
    .select('author_id, views_count, rep_bonus_50_given, rep_bonus_200_given')
    .eq('id', req.params.id).single();
  if (thread) {
    if (thread.views_count >= 50 && !thread.rep_bonus_50_given) {
      await addReputation(supabase, thread.author_id, 10);
      await supabase.from('forum_threads').update({ rep_bonus_50_given: true }).eq('id', req.params.id);
    }
    if (thread.views_count >= 200 && !thread.rep_bonus_200_given) {
      await addReputation(supabase, thread.author_id, 25);
      await supabase.from('forum_threads').update({ rep_bonus_200_given: true }).eq('id', req.params.id);
    }
    if (thread.views_count >= 500)  await grantAchievement(supabase, thread.author_id, 'popular_thread');
    if (thread.views_count >= 2000) await grantAchievement(supabase, thread.author_id, 'viral_thread');
  }
});

// ── GET /forum/threads/:id/posts ──────────────────────────────────────────────
router.get('/threads/:id/posts', optionalAuth, async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page ?? '1', 10));
  const offset = (page - 1) * PAGE_SIZE;
  const AUTHOR = 'author:profiles!forum_posts_author_id_fkey(id, nickname, avatar_url, rating_as_executor, level)';

  const { data: posts, error } = await supabase
    .from('forum_posts')
    .select(`id, content, is_deleted, moderation_status, created_at, updated_at, ${AUTHOR}, reactions:forum_reactions(id, user_id, emoji)`)
    .eq('thread_id', req.params.id)
    .order('created_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) return serverError(res, error, 'forum:posts');

  // Only admins receive the content of deleted posts (for in-thread moderation).
  // Everyone else gets the post stripped of its text so deleted content never
  // leaks over the wire, even via direct API inspection.
  let isAdmin = false;
  if (req.userId) {
    const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
    isAdmin = prof?.is_admin ?? false;
  }

  const sanitized = (posts ?? []).map(p =>
    p.is_deleted && !isAdmin ? { ...p, content: '', reactions: [] } : p
  );

  res.json({ posts: sanitized, page, has_more: (posts?.length ?? 0) === PAGE_SIZE });
});

// ── POST /forum/threads/:id/posts ─────────────────────────────────────────────
router.post('/threads/:id/posts', auth, isBanned, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Текст не может быть пустым' });
  if (content.trim().length > 10000) return res.status(400).json({ error: 'Текст не более 10 000 символов' });

  // Check thread exists and is not locked
  const { data: thread } = await supabase.from('forum_threads').select('id, is_locked').eq('id', req.params.id).single();
  if (!thread) return res.status(404).json({ error: 'Тема не найдена' });
  if (thread.is_locked) return res.status(403).json({ error: 'Тема закрыта для новых ответов' });

  const mod = await moderateSync(content, req.userId);
  if (mod.blocked) {
    const msgs = { extremism: 'Пост содержит запрещённый контент', advertising: 'Пост содержит рекламу', spam: 'Пост определён как спам' };
    return res.status(422).json({ error: msgs[mod.reason] ?? 'Пост не прошёл модерацию' });
  }

  const { data: post, error } = await supabase
    .from('forum_posts')
    .insert({
      thread_id:         req.params.id,
      author_id:         req.userId,
      content:           content.trim(),
      moderation_status: process.env.DEEPSEEK_API_KEY ? 'pending_review' : 'approved',
    })
    .select(`id, content, created_at, author:profiles!forum_posts_author_id_fkey(id, nickname, avatar_url)`)
    .single();

  if (error) return serverError(res, error, 'forum:reply');

  await addReputation(supabase, req.userId, 2);
  await bumpForumPostsCount(req.userId);

  res.status(201).json(post);
});

// ── DELETE /forum/posts/:id ───────────────────────────────────────────────────
router.delete('/posts/:id', auth, async (req, res) => {
  const { data: post } = await supabase.from('forum_posts').select('id, author_id').eq('id', req.params.id).single();
  if (!post) return res.status(404).json({ error: 'Пост не найден' });

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  const isAdmin = profile?.is_admin ?? false;

  if (post.author_id !== req.userId && !isAdmin) {
    return res.status(403).json({ error: 'Нет прав' });
  }

  const { error } = await supabase.from('forum_posts').update({
    is_deleted: true,
    deleted_by: req.userId,
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id);

  if (error) return serverError(res, error, 'forum:delete-post');

  if (isAdmin) {
    await supabase.from('forum_moderation_log').insert({
      post_id:      req.params.id,
      action:       'admin_delete',
      moderator_id: req.userId,
    });
  }

  res.status(204).end();
});

// ── POST /forum/posts/:id/react ───────────────────────────────────────────────
router.post('/posts/:id/react', auth, async (req, res) => {
  const ALLOWED = ['👍', '👎', '😂', '🔥'];
  const { emoji } = req.body;
  if (!ALLOWED.includes(emoji)) return res.status(400).json({ error: 'Недопустимая реакция' });

  const { data: existing } = await supabase
    .from('forum_reactions')
    .select('id')
    .eq('post_id', req.params.id)
    .eq('user_id', req.userId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    await supabase.from('forum_reactions').delete().eq('id', existing.id);
    return res.json({ action: 'removed' });
  }

  await supabase.from('forum_reactions').insert({ post_id: req.params.id, user_id: req.userId, emoji });
  res.json({ action: 'added' });
});

// ── POST /forum/report ────────────────────────────────────────────────────────
router.post('/report', auth, async (req, res) => {
  const { post_id, reason } = req.body;
  if (!post_id || !reason?.trim()) return res.status(400).json({ error: 'Укажите пост и причину жалобы' });

  const { error } = await supabase.from('forum_reports').insert({
    post_id,
    reporter_id: req.userId,
    reason:      reason.trim(),
  });
  if (error) return serverError(res, error, 'forum:report');
  res.status(201).json({ ok: true });
});

// ── PATCH /forum/threads/:id/lock ─────────────────────────────────────────────
router.patch('/threads/:id/lock', auth, requireAdmin, async (req, res) => {
  const { data: thread } = await supabase.from('forum_threads').select('is_locked').eq('id', req.params.id).single();
  if (!thread) return res.status(404).json({ error: 'Тема не найдена' });

  const { error } = await supabase.from('forum_threads').update({ is_locked: !thread.is_locked }).eq('id', req.params.id);
  if (error) return serverError(res, error, 'forum:lock');
  res.json({ is_locked: !thread.is_locked });
});

module.exports = router;
