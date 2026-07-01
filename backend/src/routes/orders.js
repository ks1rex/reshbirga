const { Router } = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const isBanned = require('../middleware/isBanned');
const { sendTelegram } = require('../utils/telegramNotify');
const supabase = require('../supabase_client');
const { checkAndAutoConfirm } = require('../utils/autoConfirm');
const { runAIChatCheck }      = require('../utils/aiChatCheck');
const { serverError } = require('../utils/httpError');
const { makeUploader } = require('../utils/upload');
const { sanitizeSearchTerm } = require('../utils/search');
const { addReputation, grantAchievement } = require('../utils/reputation');

const router = Router();
const upload = makeUploader();

// Optional auth (sets req.userId if a valid token is sent, doesn't reject
// anon) — the public feed (homepage/market preview) needs to render for
// logged-out visitors too; already_applied just stays false for them.
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const supabase = require('../supabase_client');
  const { data: { user } } = await supabase.auth.getUser(header.split(' ')[1]).catch(() => ({ data: {} }));
  req.userId = user?.id ?? null;
  next();
}

const AUTO_CONFIRM_HOURS = parseFloat(process.env.AUTO_CONFIRM_HOURS ?? '24');

const ORDER_DETAIL_SELECT = `
  *,
  customer:profiles!orders_customer_id_fkey(id, nickname, avatar_url),
  executor:profiles!orders_executor_id_fkey(id, nickname, avatar_url, rating_as_executor, reviews_count_executor),
  order_attachments(id, file_name, file_size, visibility, created_at)
`;

// ── FEED ─────────────────────────────────────────────────────────────────────

router.get('/', optionalAuth, async (req, res) => {
  const { search, limit } = req.query;
  const cap = Math.min(100, Math.max(1, parseInt(limit ?? '100', 10)));
  let q = supabase
    .from('orders')
    .select('id, title, subject, category, order_type, base_amount, scheduled_at, created_at, customer_id, customer:profiles!orders_customer_id_fkey(nickname, avatar_url)')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(cap);
  const s = sanitizeSearchTerm(search);
  if (s) {
    q = q.or(`title.ilike.%${s}%,description.ilike.%${s}%,subject.ilike.%${s}%`);
  }
  const { data: orders, error } = await q;
  if (error) return serverError(res, error);
  if (!orders?.length) return res.json([]);
  if (!req.userId) return res.json(orders.map(o => ({ ...o, already_applied: false })));
  const orderIds = orders.map(o => o.id);
  const { data: apps } = await supabase
    .from('order_applications').select('order_id').eq('executor_id', req.userId).in('order_id', orderIds);
  const appliedSet = new Set((apps || []).map(a => a.order_id));
  res.json(orders.map(o => ({ ...o, already_applied: appliedSet.has(o.id) })));
});

// ── CUSTOMER'S ORDERS ─────────────────────────────────────────────────────────

router.get('/mine', auth, async (req, res) => {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, title, subject, order_type, base_amount, final_amount, reserved_amount, required_topup, status, created_at, completed_at, confirmed_by_customer, confirmed_by_executor, confirmation_deadline, executor_id')
    .eq('customer_id', req.userId)
    .order('created_at', { ascending: false });
  if (error) return serverError(res, error);

  const autoConfirmedIds = new Set();
  for (const order of (orders ?? [])) {
    if (await checkAndAutoConfirm(order)) autoConfirmedIds.add(order.id);
  }
  res.json((orders ?? []).map(o => autoConfirmedIds.has(o.id) ? { ...o, status: 'completed' } : o));
});

// ── EXECUTOR'S APPLIED ORDERS ─────────────────────────────────────────────────

router.get('/applied', auth, async (req, res) => {
  const { data: apps, error } = await supabase
    .from('order_applications')
    .select(`id, status, proposed_amount, created_at,
      orders(id, title, subject, order_type, base_amount, status, confirmed_by_customer, confirmed_by_executor, confirmation_deadline, executor_id)`)
    .eq('executor_id', req.userId)
    .order('created_at', { ascending: false });
  if (error) return serverError(res, error);

  const autoConfirmedIds = new Set();
  for (const app of (apps ?? [])) {
    if (app.orders && await checkAndAutoConfirm(app.orders)) autoConfirmedIds.add(app.orders.id);
  }
  res.json((apps ?? []).map(app => ({
    ...app,
    orders: app.orders && autoConfirmedIds.has(app.orders.id) ? { ...app.orders, status: 'completed' } : app.orders,
  })));
});

// ── CREATE ────────────────────────────────────────────────────────────────────

router.post('/', auth, isBanned, async (req, res) => {
  const { title, description, subject, base_amount, requires_contact_exchange, contact_exchange_reason, category } = req.body;
  if (requires_contact_exchange && !contact_exchange_reason?.trim())
    return res.status(400).json({ error: 'Укажите, для чего нужен обмен контактами' });
  if (!title || !description || !subject || base_amount == null)
    return res.status(400).json({ error: 'Missing required fields' });
  if (String(title).length > 200 || String(subject).length > 100 || String(description).length > 5000)
    return res.status(400).json({ error: 'Превышена допустимая длина полей' });
  const amount = parseFloat(base_amount);
  if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'base_amount must be positive' });
  if (amount > 1000000) return res.status(400).json({ error: 'Сумма заказа слишком большая' });

  // No platform commission on orders — 1:1 balance transfer
  const reserved = Math.round(amount * 100) / 100;

  // Check balance and deduct atomically
  const { data: profile } = await supabase.from('profiles').select('balance').eq('id', req.userId).single();
  const currentBalance = parseFloat(profile?.balance ?? 0);
  if (currentBalance < reserved) {
    return res.status(400).json({ error: 'insufficient_balance', required: reserved, balance: currentBalance });
  }

  const { data: deducted } = await supabase.rpc('try_subtract_wallet_balance', { p_user_id: req.userId, p_amount: reserved });
  if (!deducted) {
    return res.status(400).json({ error: 'insufficient_balance', required: reserved, balance: currentBalance });
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      customer_id: req.userId, title, description, subject, order_type: 'order',
      base_amount: amount, commission_amount: 0, reserved_amount: reserved,
      final_amount: null, deposit_amount: 0,
      requires_contact_exchange: !!requires_contact_exchange,
      contact_exchange_reason: requires_contact_exchange ? String(contact_exchange_reason).trim() : null,
      category: category || null,
      status: 'open',
    })
    .select().single();

  if (orderErr) {
    await supabase.rpc('add_wallet_balance', { p_user_id: req.userId, p_amount: reserved });
    return serverError(res, orderErr);
  }

  await supabase.from('transactions').insert({
    user_id: req.userId, order_id: order.id,
    type: 'order_payment', amount: reserved, status: 'completed',
  });

  res.status(201).json(order);
});

// ── PENDING REVIEWS ───────────────────────────────────────────────────────────

router.get('/pending-reviews', auth, async (req, res) => {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, title, subject, completed_at, customer_id, executor_id')
    .eq('status', 'completed')
    .or(`customer_id.eq.${req.userId},executor_id.eq.${req.userId}`)
    .order('completed_at', { ascending: false })
    .limit(50);
  if (error) return serverError(res, error);
  if (!orders?.length) return res.json([]);

  const orderIds = orders.map(o => o.id);
  const { data: existing } = await supabase
    .from('reviews')
    .select('order_id')
    .eq('reviewer_id', req.userId)
    .in('order_id', orderIds);

  const reviewedIds = new Set((existing ?? []).map(r => r.order_id));
  res.json(orders
    .filter(o => !reviewedIds.has(o.id))
    .map(o => ({ ...o, role: o.customer_id === req.userId ? 'customer' : 'executor' })));
});

// ── DETAIL ────────────────────────────────────────────────────────────────────

router.get('/:id', auth, async (req, res) => {
  let { data: order, error } = await supabase.from('orders').select(ORDER_DETAIL_SELECT).eq('id', req.params.id).single();
  if (error || !order) return res.status(404).json({ error: 'Order not found' });

  const isCustomer = order.customer_id === req.userId;
  const isExecutor  = order.executor_id === req.userId;
  const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  const isAdmin = prof?.is_admin === true;

  if (order.status !== 'open' && !isCustomer && !isExecutor && !isAdmin)
    return res.status(403).json({ error: 'Forbidden' });

  if (await checkAndAutoConfirm(order)) {
    ({ data: order } = await supabase.from('orders').select(ORDER_DETAIL_SELECT).eq('id', req.params.id).single());
  }

  order.order_attachments = (order.order_attachments || []).filter(att => {
    if (isAdmin || isCustomer) return true;
    if (att.visibility === 'public') return true;
    return att.visibility === 'after_assignment' && isExecutor && order.executor_id != null;
  });

  const { data: existingApp } = await supabase
    .from('order_applications').select('id, status').eq('order_id', req.params.id).eq('executor_id', req.userId).maybeSingle();
  order.already_applied = existingApp != null;
  order.my_application_status = existingApp?.status ?? null;

  res.json(order);
});

// ── APPLY ─────────────────────────────────────────────────────────────────────

router.post('/:id/apply', auth, isBanned, async (req, res) => {
  const { message, proposed_amount } = req.body;
  const orderId = req.params.id;
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
  if (message.length > 2000) return res.status(400).json({ error: 'Сообщение слишком длинное' });

  const { data: order } = await supabase.from('orders').select('id, customer_id, order_type, status').eq('id', orderId).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'open') return res.status(400).json({ error: 'Order is not open' });
  if (order.customer_id === req.userId) return res.status(400).json({ error: 'Cannot apply to own order' });

  // proposed_amount is always required — executor names their price
  const pa = parseFloat(proposed_amount);
  if (!proposed_amount || isNaN(pa) || pa <= 0)
    return res.status(400).json({ error: 'proposed_amount обязателен — укажите свою цену' });
  if (pa > 1000000) return res.status(400).json({ error: 'Сумма слишком большая' });

  const { data: existing } = await supabase.from('order_applications').select('id').eq('order_id', orderId).eq('executor_id', req.userId).maybeSingle();
  if (existing) return res.status(409).json({ error: 'Already applied' });

  const { data: app, error } = await supabase.from('order_applications').insert({
    order_id: orderId,
    executor_id: req.userId,
    message: message.trim(),
    proposed_amount: pa,
    status: 'pending',
  }).select().single();
  if (error) return serverError(res, error);
  res.status(201).json(app);
});

// ── APPLICATIONS ──────────────────────────────────────────────────────────────

router.get('/:id/applications', auth, async (req, res) => {
  const { data: order } = await supabase.from('orders').select('id, customer_id').eq('id', req.params.id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  if (order.customer_id !== req.userId && !prof?.is_admin)
    return res.status(403).json({ error: 'Forbidden' });

  const { data: apps, error } = await supabase
    .from('order_applications')
    .select(`id, message, proposed_amount, status, created_at, executor:profiles!order_applications_executor_id_fkey(id, nickname, avatar_url, rating_as_executor, reviews_count_executor)`)
    .eq('order_id', req.params.id)
    .order('created_at', { ascending: true });
  if (error) return serverError(res, error);
  res.json(apps);
});

// ── SELECT EXECUTOR ───────────────────────────────────────────────────────────

router.post('/:id/applications/:appId/select', auth, isBanned, async (req, res) => {
  const { id: orderId, appId } = req.params;
  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.customer_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });
  if (order.status !== 'open') return res.status(400).json({ error: 'Order is not open' });

  const { data: app } = await supabase.from('order_applications').select('*').eq('id', appId).eq('order_id', orderId).single();
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (app.status !== 'pending') return res.status(400).json({ error: 'Application is not pending' });
  if (app.executor_id === order.customer_id) return res.status(400).json({ error: 'Нельзя выбрать самого себя исполнителем' });

  if (!app.proposed_amount) return res.status(400).json({ error: 'Application has no proposed_amount' });

  // No commission — 1:1 transfers
  const final_amount = Math.round(parseFloat(app.proposed_amount) * 100) / 100;
  const reserved     = Math.round(parseFloat(order.reserved_amount) * 100) / 100;
  let newStatus;

  if (final_amount <= reserved) {
    const diff = Math.round((reserved - final_amount) * 100) / 100;
    newStatus = 'in_progress';

    const { data: claimed, error: orderErr } = await supabase.from('orders')
      .update({ executor_id: app.executor_id, final_amount, commission_amount: 0, reserved_amount: final_amount, status: 'in_progress' })
      .eq('id', orderId).eq('status', 'open').select('id');
    if (orderErr) return serverError(res, orderErr, 'select:update');
    if (!claimed?.length) return res.status(409).json({ error: 'Заказ уже не открыт' });

    if (diff > 0) {
      await supabase.rpc('add_wallet_balance', { p_user_id: order.customer_id, p_amount: diff });
      await supabase.from('transactions').insert({
        user_id: order.customer_id, order_id: orderId,
        type: 'order_refund_excess', amount: diff, status: 'completed',
      });
    }
  } else {
    const topup = Math.round((final_amount - reserved) * 100) / 100;
    newStatus = 'awaiting_topup';

    const { data: claimed, error: orderErr } = await supabase.from('orders')
      .update({ executor_id: app.executor_id, final_amount, commission_amount: 0, required_topup: topup, status: 'awaiting_topup' })
      .eq('id', orderId).eq('status', 'open').select('id');
    if (orderErr) return serverError(res, orderErr, 'select:topup:update');
    if (!claimed?.length) return res.status(409).json({ error: 'Заказ уже не открыт' });
  }

  await supabase.from('order_applications').update({ status: 'accepted' }).eq('id', appId);
  await supabase.from('order_applications').update({ status: 'rejected' }).eq('order_id', orderId).neq('id', appId).eq('status', 'pending');

  res.json({ status: newStatus, final_amount });
});

// ── TOPUP (customer pays the extra when awaiting_topup) ───────────────────────

router.post('/:id/topup', auth, isBanned, async (req, res) => {
  const orderId = req.params.id;
  const { data: order } = await supabase.from('orders')
    .select('id, customer_id, status, required_topup, reserved_amount').eq('id', orderId).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.customer_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });
  if (order.status !== 'awaiting_topup') return res.status(400).json({ error: 'Заказ не ожидает доплаты' });

  const diff = Math.round(parseFloat(order.required_topup ?? 0) * 100) / 100;
  if (diff <= 0) return res.status(400).json({ error: 'required_topup not set' });

  const { data: profile } = await supabase.from('profiles').select('balance').eq('id', req.userId).single();
  const currentBalance = parseFloat(profile?.balance ?? 0);
  if (currentBalance < diff) {
    return res.status(400).json({ error: 'insufficient_balance', required: diff, balance: currentBalance });
  }

  const { data: deducted } = await supabase.rpc('try_subtract_wallet_balance', { p_user_id: req.userId, p_amount: diff });
  if (!deducted) {
    return res.status(400).json({ error: 'insufficient_balance', required: diff, balance: currentBalance });
  }

  const newReserved = Math.round((parseFloat(order.reserved_amount) + diff) * 100) / 100;

  const { data: updated, error: orderErr } = await supabase.from('orders')
    .update({ reserved_amount: newReserved, required_topup: null, status: 'in_progress' })
    .eq('id', orderId).eq('status', 'awaiting_topup').select('id');

  if (orderErr || !updated?.length) {
    await supabase.rpc('add_wallet_balance', { p_user_id: req.userId, p_amount: diff });
    if (orderErr) return serverError(res, orderErr, 'topup:order-update');
    return res.status(409).json({ error: 'Заказ уже не ожидает доплаты' });
  }

  await supabase.from('transactions').insert({
    user_id: req.userId, order_id: orderId,
    type: 'order_topup', amount: diff, status: 'completed',
  });

  res.json({ status: 'in_progress', topup_amount: diff });
});

// ── CANCEL (customer, open order without executor) ────────────────────────────

router.post('/:id/cancel', auth, isBanned, async (req, res) => {
  const orderId = req.params.id;
  const { data: order } = await supabase.from('orders')
    .select('id, customer_id, status, reserved_amount, executor_id').eq('id', orderId).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.customer_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  // Cancellable states for the customer:
  //   - 'open' without a chosen executor (no work started)
  //   - 'awaiting_topup' (executor priced above budget, customer can't/won't top up → exit)
  const isOpenUnassigned = order.status === 'open' && order.executor_id == null;
  const isStuckTopup     = order.status === 'awaiting_topup';
  if (!isOpenUnassigned && !isStuckTopup)
    return res.status(400).json({ error: 'Отменить можно только открытый заказ без исполнителя или заказ, ожидающий доплаты' });

  // Full 1:1 refund of the reserved amount (the top-up was never paid)
  const refundAmount = Math.round(parseFloat(order.reserved_amount) * 100) / 100;

  // Conditional claim guards against races: a concurrent executor-select on an
  // open order, or a concurrent top-up moving awaiting_topup → in_progress.
  let q = supabase.from('orders')
    .update({ status: 'cancelled', required_topup: null })
    .eq('id', orderId).eq('status', order.status);
  if (isOpenUnassigned) q = q.is('executor_id', null);
  const { data: cancelled, error: cancelErr } = await q.select('id');
  if (cancelErr) return serverError(res, cancelErr, 'cancel:order-update');
  if (!cancelled?.length) return res.status(409).json({ error: 'Заказ уже не может быть отменён' });

  // Full 1:1 refund of the reserved amount — no commission on orders
  await supabase.rpc('add_wallet_balance', { p_user_id: order.customer_id, p_amount: refundAmount });
  await supabase.from('transactions').insert({
    user_id: order.customer_id, order_id: orderId,
    type: 'order_cancel_refund', amount: refundAmount, status: 'completed',
  });

  // Fire-and-forget AI scan (no disputes on plain cancel, so will run)
  runAIChatCheck(orderId).catch(() => {});

  res.json({ status: 'cancelled', refunded: refundAmount });
});

// ── CONFIRM COMPLETION ────────────────────────────────────────────────────────

router.post('/:id/confirm', auth, async (req, res) => {
  const { data: order } = await supabase.from('orders').select('*').eq('id', req.params.id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const isCustomer = order.customer_id === req.userId;
  const isExecutor  = order.executor_id === req.userId;
  if (!isCustomer && !isExecutor) return res.status(403).json({ error: 'Forbidden' });

  if (!['in_progress', 'awaiting_confirmation'].includes(order.status))
    return res.status(400).json({ error: `Cannot confirm in status '${order.status}'` });

  if (isCustomer && order.confirmed_by_customer)
    return res.status(400).json({ error: 'Already confirmed by customer' });
  if (isExecutor && order.confirmed_by_executor)
    return res.status(400).json({ error: 'Already confirmed by executor' });

  const payoutAmount = Math.round(parseFloat(order.final_amount ?? order.base_amount) * 100) / 100;
  const otherConfirmed = isCustomer ? order.confirmed_by_executor : order.confirmed_by_customer;

  if (otherConfirmed) {
    const { data: completed, error: orderErr } = await supabase.from('orders').update({
      ...(isCustomer ? { confirmed_by_customer: true } : { confirmed_by_executor: true }),
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', order.id)
      .in('status', ['in_progress', 'awaiting_confirmation'])
      .select('id');
    if (orderErr) return serverError(res, orderErr, 'confirm:complete');
    if (!completed?.length) return res.json({ status: 'completed' }); // already done

    // Payout executor immediately via balance
    await supabase.rpc('add_wallet_balance', { p_user_id: order.executor_id, p_amount: payoutAmount });
    await supabase.from('transactions').insert({
      user_id: order.executor_id, order_id: order.id,
      type: 'order_payout', amount: payoutAmount, status: 'completed',
    });

    // Deal/reputation/achievement bookkeeping for the executor
    const { data: execProf } = await supabase.from('profiles')
      .select('deals_count').eq('id', order.executor_id).single();
    const dealsCount = (execProf?.deals_count ?? 0) + 1;
    await supabase.from('profiles').update({ deals_count: dealsCount }).eq('id', order.executor_id);
    await addReputation(supabase, order.executor_id, 50);
    if (dealsCount === 1)   await grantAchievement(supabase, order.executor_id, 'first_deal');
    if (dealsCount === 5)   await grantAchievement(supabase, order.executor_id, 'deals_5');
    if (dealsCount === 20)  await grantAchievement(supabase, order.executor_id, 'deals_20');
    if (dealsCount === 50)  await grantAchievement(supabase, order.executor_id, 'deals_50');
    if (dealsCount === 100) await grantAchievement(supabase, order.executor_id, 'deals_100');

    // Return deposit to customer if any
    const depositAmt = Math.round(parseFloat(order.deposit_amount ?? 0) * 100) / 100;
    if (depositAmt > 0) {
      await supabase.rpc('add_wallet_balance', { p_user_id: order.customer_id, p_amount: depositAmt });
      await supabase.from('transactions').insert({
        user_id: order.customer_id, order_id: order.id,
        type: 'deposit_release', amount: depositAmt, status: 'completed',
      });
    }

    // Fire-and-forget AI chat scan after order completion
    runAIChatCheck(order.id).catch(() => {});

    return res.json({ status: 'completed' });
  }

  // First confirmation
  const deadline = new Date(Date.now() + AUTO_CONFIRM_HOURS * 3600000).toISOString();
  const { error: orderErr } = await supabase.from('orders').update({
    ...(isCustomer ? { confirmed_by_customer: true } : { confirmed_by_executor: true }),
    status: 'awaiting_confirmation',
    confirmation_deadline: deadline,
  }).eq('id', order.id);
  if (orderErr) return serverError(res, orderErr);

  res.json({ status: 'awaiting_confirmation', confirmation_deadline: deadline });
});

// ── OPEN DISPUTE ──────────────────────────────────────────────────────────────

router.post('/:id/dispute', auth, isBanned, async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'reason is required' });
  if (reason.length > 2000) return res.status(400).json({ error: 'Слишком длинный текст' });

  const { data: order } = await supabase.from('orders').select('id, customer_id, executor_id, status').eq('id', req.params.id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const isParty = order.customer_id === req.userId || order.executor_id === req.userId;
  if (!isParty) return res.status(403).json({ error: 'Forbidden' });

  if (!['in_progress', 'awaiting_confirmation'].includes(order.status))
    return res.status(400).json({ error: 'Cannot open dispute in current status' });

  const { error: disputeErr } = await supabase.from('disputes')
    .insert({ order_id: order.id, opened_by: req.userId, reason: reason.trim(), status: 'open' });
  if (disputeErr) return serverError(res, disputeErr);

  const { error: orderErr } = await supabase.from('orders').update({ status: 'disputed' }).eq('id', order.id);
  if (orderErr) return serverError(res, orderErr);

  sendTelegram(`⚠️ Новый спор\nЗаказ: ${order.title ?? order.id}\nПричина: ${reason.trim().slice(0, 200)}`);

  res.json({ status: 'disputed' });
});

// ── REVIEWS ───────────────────────────────────────────────────────────────────

router.get('/:id/reviews', auth, async (req, res) => {
  const orderId = req.params.id;
  const { data: order } = await supabase.from('orders').select('id, customer_id, executor_id').eq('id', orderId).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  const isParty = order.customer_id === req.userId || order.executor_id === req.userId;
  if (!isParty && !prof?.is_admin) return res.status(403).json({ error: 'Forbidden' });

  const { data: reviews, error } = await supabase
    .from('reviews')
    .select('id, rating, comment, context, created_at, reviewer_id, reviewer:profiles!reviews_reviewer_id_fkey(id, nickname)')
    .eq('order_id', orderId);
  if (error) return serverError(res, error);

  const myReview = (reviews ?? []).find(r => r.reviewer_id === req.userId) ?? null;
  res.json({ reviews: reviews ?? [], has_reviewed: myReview != null, my_review: myReview });
});

router.post('/:id/reviews', auth, isBanned, async (req, res) => {
  const orderId = req.params.id;
  const { rating, comment } = req.body;

  const r = parseInt(rating, 10);
  if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'rating must be 1-5' });
  if (comment && String(comment).length > 2000) return res.status(400).json({ error: 'Слишком длинный отзыв' });

  const { data: order } = await supabase.from('orders').select('id, customer_id, executor_id, status').eq('id', orderId).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'completed') return res.status(400).json({ error: 'Order is not completed' });

  const isCustomer = order.customer_id === req.userId;
  const isExecutor  = order.executor_id === req.userId;
  if (!isCustomer && !isExecutor) return res.status(403).json({ error: 'Forbidden' });

  const reviewee_id = isCustomer ? order.executor_id : order.customer_id;
  const context     = isCustomer ? 'as_executor'     : 'as_customer';

  const { data: existing } = await supabase.from('reviews').select('id')
    .eq('order_id', orderId).eq('reviewer_id', req.userId).maybeSingle();
  if (existing) return res.status(409).json({ error: 'Already reviewed' });

  const { data: review, error } = await supabase.from('reviews')
    .insert({ order_id: orderId, reviewer_id: req.userId, reviewee_id, context, rating: r, comment: comment?.trim() || null })
    .select().single();
  if (error) return serverError(res, error);

  // Reputation for the rating + achievement checks (DB trigger already
  // recalculated profiles.average_rating/reviews_count on insert above).
  if (r === 5) await addReputation(supabase, reviewee_id, 30);
  else if (r === 4) await addReputation(supabase, reviewee_id, 15);

  const { data: revProf } = await supabase.from('profiles')
    .select('average_rating, reviews_count').eq('id', reviewee_id).single();
  if ((revProf?.reviews_count ?? 0) >= 10 && (revProf?.average_rating ?? 0) >= 4.8) {
    await grantAchievement(supabase, reviewee_id, 'top_rated');
  }
  const { data: last5 } = await supabase.from('reviews')
    .select('rating').eq('reviewee_id', reviewee_id).order('created_at', { ascending: false }).limit(5);
  if (last5?.length === 5 && last5.every(rv => rv.rating === 5)) {
    await grantAchievement(supabase, reviewee_id, 'perfect_score');
  }

  res.status(201).json(review);
});

// ── CONVERSATION ──────────────────────────────────────────────────────────────

router.get('/:id/conversation', auth, async (req, res) => {
  const { data: order } = await supabase.from('orders')
    .select('id, customer_id, executor_id, status, requires_contact_exchange, contact_exchange_reason')
    .eq('id', req.params.id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const chatStatuses = ['in_progress', 'awaiting_confirmation', 'completed', 'disputed', 'cancelled', 'assigned', 'awaiting_topup'];
  if (!chatStatuses.includes(order.status)) return res.status(404).json({ error: 'No conversation yet' });

  const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  const isAdmin = prof?.is_admin === true;
  const isParty = order.customer_id === req.userId || order.executor_id === req.userId;
  if (!isParty && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  let { data: conv } = await supabase.from('conversations')
    .select('id').eq('order_id', req.params.id).eq('type', 'order_chat').maybeSingle();

  if (!conv && order.executor_id) {
    const { data: created, error: convErr } = await supabase.from('conversations')
      .insert({ type: 'order_chat', order_id: order.id }).select('id').single();
    if (convErr) return serverError(res, convErr, 'conversation:lazy-create');
    await supabase.from('conversation_participants').insert([
      { conversation_id: created.id, user_id: order.customer_id, role: 'customer' },
      { conversation_id: created.id, user_id: order.executor_id, role: 'executor' },
    ]);

    // System message for contact exchange
    if (order.requires_contact_exchange && order.contact_exchange_reason) {
      const reason = order.contact_exchange_reason;
      await supabase.from('messages').insert({
        conversation_id: created.id,
        sender_id: null,
        content:
          `⚠️ Для этого заказа предусмотрен обмен контактными данными: «${reason}».\n` +
          `Пожалуйста, фиксируйте момент передачи и возврата (фото/видео) и прикладывайте их в этот чат — без таких подтверждений сайт не может гарантировать честность сделки при споре.\n` +
          `⛔ Попытка договориться и провести сделку в обход платформы (минуя оплату через сайт) — основание для блокировки ОБОИХ аккаунтов.`,
        is_contact_info: false,
      });
    }

    conv = created;
  }

  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ conversation_id: conv.id });
});

// ── ATTACHMENTS ───────────────────────────────────────────────────────────────

router.post('/:id/attachments', auth, upload.single('file'), async (req, res) => {
  const orderId    = req.params.id;
  const visibility = req.body.visibility === 'after_assignment' ? 'after_assignment' : 'public';
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const { data: order } = await supabase.from('orders').select('id, customer_id, executor_id').eq('id', orderId).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.customer_id !== req.userId && order.executor_id !== req.userId)
    return res.status(403).json({ error: 'Forbidden' });

  const storagePath = `${orderId}/${uuidv4()}${path.extname(req.file.originalname)}`;
  const { error: upErr } = await supabase.storage.from('order-attachments')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });
  if (upErr) return serverError(res, upErr);

  const { data: att, error: dbErr } = await supabase.from('order_attachments')
    .insert({ order_id: orderId, uploaded_by: req.userId, file_path: storagePath, file_name: req.file.originalname, file_size: req.file.size, visibility })
    .select().single();
  if (dbErr) return serverError(res, dbErr);
  res.status(201).json(att);
});

router.get('/:id/attachments/:attachmentId/download', auth, async (req, res) => {
  const { id: orderId, attachmentId } = req.params;
  const { data: att } = await supabase.from('order_attachments')
    .select('*, orders(customer_id, executor_id, status)').eq('id', attachmentId).eq('order_id', orderId).single();
  if (!att) return res.status(404).json({ error: 'Attachment not found' });

  const { orders: order } = att;
  const isCustomer = order.customer_id === req.userId;
  const isExecutor  = order.executor_id === req.userId;
  const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  const isAdmin = prof?.is_admin === true;

  const publicOk   = att.visibility === 'public' && (isCustomer || isExecutor || order.status === 'open');
  const assignedOk = att.visibility === 'after_assignment' && order.executor_id != null && (isCustomer || isExecutor);
  if (!isAdmin && !publicOk && !assignedOk) return res.status(403).json({ error: 'Forbidden' });

  const { data: signed, error: signErr } = await supabase.storage.from('order-attachments').createSignedUrl(att.file_path, 300);
  if (signErr) return serverError(res, signErr);
  res.json({ url: signed.signedUrl, filename: att.file_name });
});

module.exports = router;
