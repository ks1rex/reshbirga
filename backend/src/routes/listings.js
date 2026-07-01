const { Router } = require('express');
const auth    = require('../middleware/auth');
const isBanned = require('../middleware/isBanned');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');
const { getListingUsage } = require('../utils/listingLimit');

const router = Router();

// Optional auth — GET / is the public catalog (ServicesCatalog, Market,
// Home previews are all unauthenticated pages), so it must not 401 for
// logged-out visitors. owner_id=me still needs req.userId, handled below.
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const { data: { user } } = await supabase.auth.getUser(header.split(' ')[1]).catch(() => ({ data: {} }));
  req.userId = user?.id ?? null;
  next();
}

const CONTACT_EXCHANGE_SYSTEM_MSG = (reason) =>
  `⚠️ Для этого заказа предусмотрен обмен контактными данными: «${reason}».\n` +
  `Пожалуйста, фиксируйте момент передачи и возврата (фото/видео) и прикладывайте их в этот чат — без таких подтверждений сайт не может гарантировать честность сделки при споре.\n` +
  `⛔ Попытка договориться и провести сделку в обход платформы (минуя оплату через сайт) — основание для блокировки ОБОИХ аккаунтов.`;

function validateListing({ title, description, price, deposit_amount, requires_contact_exchange, contact_exchange_reason }) {
  if (!title?.trim())       return 'title обязателен';
  if (!description?.trim()) return 'description обязателен';
  if (String(title).length > 200)       return 'Заголовок слишком длинный';
  if (String(description).length > 5000) return 'Описание слишком длинное';
  const p = parseFloat(price);
  if (!price || isNaN(p) || p <= 0) return 'price должен быть > 0';
  if (p > 1000000)                   return 'Цена слишком большая';
  const d = parseFloat(deposit_amount ?? 0);
  if (isNaN(d) || d < 0)            return 'deposit_amount должен быть >= 0';
  if (d > 1000000)                   return 'Залог слишком большой';
  if (requires_contact_exchange && !contact_exchange_reason?.trim())
    return 'Укажите, для чего нужен обмен контактами';
  return null;
}

// ── GET /listings/categories ──────────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  const { data, error } = await supabase.from('market_categories').select('*').order('sort_order');
  if (error) return serverError(res, error);
  res.json({ categories: data ?? [] });
});

// ── POST /listings ────────────────────────────────────────────────────────────
router.post('/', auth, isBanned, async (req, res) => {
  const { title, description, price, deposit_amount, requires_contact_exchange, contact_exchange_reason, category } = req.body;
  const validationError = validateListing(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { used, limit } = await getListingUsage(req.userId);
  if (used >= limit) {
    return res.status(400).json({ error: `Достигнут лимит активных объявлений (${limit}). Скройте одно из существующих или купите VIP.` });
  }

  const { data: listing, error } = await supabase.from('listings').insert({
    owner_id: req.userId,
    title: String(title).trim(),
    description: String(description).trim(),
    price: parseFloat(price),
    deposit_amount: parseFloat(deposit_amount ?? 0),
    requires_contact_exchange: !!requires_contact_exchange,
    contact_exchange_reason: requires_contact_exchange ? String(contact_exchange_reason).trim() : null,
    category: category || null,
    is_active: true,
  }).select().single();
  if (error) return serverError(res, error);
  res.status(201).json(listing);
});

// ── GET /listings ─────────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  const { search, owner_id, limit } = req.query;
  let q = supabase
    .from('listings')
    .select(`*, owner:profiles!listings_owner_id_fkey(id, nickname, avatar_url, rating_as_executor, reviews_count_executor)`)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, parseInt(limit ?? '200', 10))));

  if (owner_id && owner_id !== 'me') {
    q = q.eq('owner_id', owner_id);
  } else {
    q = q.eq('is_active', true);
  }

  const { data, error } = await q;
  if (error) return serverError(res, error);
  let result = data ?? [];
  if (search?.trim()) {
    const s = search.trim().toLowerCase();
    result = result.filter(l => l.title.toLowerCase().includes(s) || l.description.toLowerCase().includes(s));
  }
  res.json(result);
});

// ── GET /listings/mine ────────────────────────────────────────────────────────
router.get('/mine', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('owner_id', req.userId)
    .order('created_at', { ascending: false });
  if (error) return serverError(res, error);
  const { used, limit } = await getListingUsage(req.userId);
  res.json({ listings: data ?? [], usage: { used, limit } });
});

// ── GET /listings/:id ─────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  const { data: listing, error } = await supabase
    .from('listings')
    .select(`*, owner:profiles!listings_owner_id_fkey(id, nickname, avatar_url, rating_as_executor, reviews_count_executor)`)
    .eq('id', req.params.id)
    .single();
  if (error || !listing) return res.status(404).json({ error: 'Услуга не найдена' });

  const isOwner = listing.owner_id === req.userId;
  const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  if (!listing.is_active && !isOwner && !prof?.is_admin)
    return res.status(404).json({ error: 'Услуга не найдена' });

  res.json(listing);
});

// ── PATCH /listings/:id ───────────────────────────────────────────────────────
router.patch('/:id', auth, isBanned, async (req, res) => {
  const { data: listing } = await supabase.from('listings').select('owner_id').eq('id', req.params.id).single();
  if (!listing) return res.status(404).json({ error: 'Услуга не найдена' });
  if (listing.owner_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  const validationError = validateListing(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { title, description, price, deposit_amount, requires_contact_exchange, contact_exchange_reason } = req.body;
  const { data: updated, error } = await supabase.from('listings')
    .update({
      title: String(title).trim(),
      description: String(description).trim(),
      price: parseFloat(price),
      deposit_amount: parseFloat(deposit_amount ?? 0),
      requires_contact_exchange: !!requires_contact_exchange,
      contact_exchange_reason: requires_contact_exchange ? String(contact_exchange_reason).trim() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select().single();
  if (error) return serverError(res, error);
  res.json(updated);
});

// ── PATCH /listings/:id/toggle ────────────────────────────────────────────────
router.patch('/:id/toggle', auth, isBanned, async (req, res) => {
  const { data: listing } = await supabase.from('listings').select('owner_id, is_active').eq('id', req.params.id).single();
  if (!listing) return res.status(404).json({ error: 'Услуга не найдена' });
  if (listing.owner_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  const turningOn = !listing.is_active;
  if (turningOn) {
    const { used, limit } = await getListingUsage(req.userId);
    if (used >= limit) {
      return res.status(400).json({ error: `Достигнут лимит активных объявлений (${limit}). Скройте другое объявление или купите VIP.` });
    }
  }

  const { data: updated, error } = await supabase.from('listings')
    .update({ is_active: turningOn, hidden_reason: turningOn ? null : 'owner', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, is_active, hidden_reason').single();
  if (error) return serverError(res, error);
  res.json(updated);
});

// ── POST /listings/:id/order ──────────────────────────────────────────────────
router.post('/:id/order', auth, isBanned, async (req, res) => {
  const { comment } = req.body;

  const { data: listing, error: listErr } = await supabase
    .from('listings').select('*').eq('id', req.params.id).single();
  if (listErr || !listing) return res.status(404).json({ error: 'Услуга не найдена' });
  if (!listing.is_active) return res.status(400).json({ error: 'Услуга недоступна' });
  if (listing.owner_id === req.userId) return res.status(400).json({ error: 'Нельзя заказать собственную услугу' });

  const price      = Math.round(parseFloat(listing.price) * 100) / 100;
  const deposit    = Math.round(parseFloat(listing.deposit_amount ?? 0) * 100) / 100;
  const reserved   = Math.round((price + deposit) * 100) / 100;

  // Check and deduct balance
  const { data: profile } = await supabase.from('profiles').select('balance').eq('id', req.userId).single();
  const currentBalance = parseFloat(profile?.balance ?? 0);
  if (currentBalance < reserved)
    return res.status(400).json({ error: 'insufficient_balance', required: reserved, balance: currentBalance });

  const { data: deducted } = await supabase.rpc('try_subtract_wallet_balance', { p_user_id: req.userId, p_amount: reserved });
  if (!deducted)
    return res.status(400).json({ error: 'insufficient_balance', required: reserved, balance: currentBalance });

  // Compose description
  const description = listing.description +
    (comment?.trim() ? `\n\nКомментарий заказчика: ${comment.trim()}` : '');

  // Create order (service type, executor known immediately)
  const { data: order, error: orderErr } = await supabase.from('orders').insert({
    customer_id:              req.userId,
    executor_id:              listing.owner_id,
    order_type:               'service',
    title:                    listing.title,
    description,
    subject:                  'Услуга',
    base_amount:              price,
    final_amount:             price,
    reserved_amount:          reserved,
    commission_amount:        0,
    deposit_amount:           deposit,
    requires_contact_exchange: listing.requires_contact_exchange,
    contact_exchange_reason:  listing.contact_exchange_reason,
    status:                   'in_progress',
  }).select().single();

  if (orderErr) {
    await supabase.rpc('add_wallet_balance', { p_user_id: req.userId, p_amount: reserved });
    return serverError(res, orderErr, 'listing:order:create');
  }

  // Transactions
  const txInserts = [
    { user_id: req.userId, order_id: order.id, type: 'order_payment', amount: price, status: 'completed' },
  ];
  if (deposit > 0) {
    txInserts.push({ user_id: req.userId, order_id: order.id, type: 'deposit_hold', amount: deposit, status: 'completed' });
  }
  await supabase.from('transactions').insert(txInserts);

  // Create conversation immediately (executor known at creation)
  const { data: conv } = await supabase.from('conversations')
    .insert({ type: 'order_chat', order_id: order.id })
    .select('id').single();

  if (conv) {
    await supabase.from('conversation_participants').insert([
      { conversation_id: conv.id, user_id: req.userId,        role: 'customer' },
      { conversation_id: conv.id, user_id: listing.owner_id,  role: 'executor' },
    ]);

    // System message for contact exchange
    if (listing.requires_contact_exchange && listing.contact_exchange_reason) {
      await supabase.from('messages').insert({
        conversation_id: conv.id,
        sender_id: null,
        content: CONTACT_EXCHANGE_SYSTEM_MSG(listing.contact_exchange_reason),
        is_contact_info: false,
      });
    }
  }

  res.status(201).json({ ...order, conversation_id: conv?.id ?? null });
});

module.exports = router;
