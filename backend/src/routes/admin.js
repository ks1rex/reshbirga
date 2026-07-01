const { Router } = require('express');
const auth = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');
const { sanitizeSearchTerm } = require('../utils/search');
const { sendTelegram } = require('../utils/telegramNotify');
const { grantAchievement } = require('../utils/reputation');

const router = Router();
router.use(auth, adminMiddleware);

// GET /admin/ledger — read-only transaction log with filters
router.get('/ledger', async (req, res) => {
  const { type, nickname, date_from, date_to } = req.query;

  let q = supabase
    .from('transactions')
    .select(`
      id, type, amount, status, created_at, order_id,
      user:profiles!transactions_user_id_fkey(id, nickname)
    `)
    .order('created_at', { ascending: false })
    .limit(500);

  if (type) q = q.eq('type', type);
  if (date_from) q = q.gte('created_at', date_from);
  if (date_to)   q = q.lte('created_at', date_to);

  const { data, error } = await q;
  if (error) return serverError(res, error);

  let result = data ?? [];
  if (nickname?.trim()) {
    const s = nickname.trim().toLowerCase();
    result = result.filter(tx => tx.user?.nickname?.toLowerCase().includes(s));
  }

  res.json(result);
});

// ─── Disputes ───────────────────────────────────────────────

// GET /admin/disputes?status=open
router.get('/disputes', async (req, res) => {
  const { status } = req.query;

  let q = supabase
    .from('disputes')
    .select(`
      id, reason, status, created_at,
      opened_by_profile:profiles!disputes_opened_by_fkey(id, nickname),
      orders!inner(
        id, title, order_type, base_amount, final_amount, commission_amount, reserved_amount, status,
        customer:profiles!orders_customer_id_fkey(id, nickname),
        executor:profiles!orders_executor_id_fkey(id, nickname)
      )
    `)
    .order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);
  else q = q.eq('status', 'open');

  const { data, error } = await q;
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// POST /admin/disputes/:id/resolve
router.post('/disputes/:id/resolve', async (req, res) => {
  const { id } = req.params;
  const { resolution, admin_comment, ban_customer, ban_executor } = req.body;

  // site_error is an alias for refund_customer
  const normalised = resolution === 'site_error' ? 'refund_customer' : resolution;
  if (!['pay_executor', 'refund_customer'].includes(normalised))
    return res.status(400).json({ error: 'Invalid resolution' });

  const DISPUTE_STATUS = { pay_executor: 'resolved_pay_executor', refund_customer: 'resolved_refund_customer' };
  const now            = new Date().toISOString();

  // Atomically claim the dispute: only the first resolver flips it out of 'open'
  // and proceeds to move money. Concurrent/double calls get 0 rows -> 409, so no
  // double payout (idempotency guard, same pattern as deposits/withdrawals).
  const { data: claimedRows, error: claimErr } = await supabase
    .from('disputes')
    .update({
      status: DISPUTE_STATUS[normalised],
      admin_comment: admin_comment ?? null,
      resolved_by: req.userId,
      resolved_at: now,
    })
    .eq('id', id).eq('status', 'open')
    .select(`id, orders!inner(id, customer_id, executor_id, final_amount, reserved_amount, deposit_amount)`);

  if (claimErr) return serverError(res, claimErr, 'dispute:resolve:claim');
  if (!claimedRows?.length) return res.status(409).json({ error: 'Спор уже разрешён или не найден' });

  const order      = claimedRows[0].orders;
  const finalAmt   = Math.round(parseFloat(order.final_amount ?? order.reserved_amount) * 100) / 100;
  const depositAmt = Math.round(parseFloat(order.deposit_amount ?? 0) * 100) / 100;
  const refAmt     = Math.round(parseFloat(order.reserved_amount) * 100) / 100;

  if (normalised === 'pay_executor') {
    await supabase.from('orders').update({ status: 'completed', completed_at: now }).eq('id', order.id);
    // Executor gets final_amount (price)
    await supabase.rpc('add_wallet_balance', { p_user_id: order.executor_id, p_amount: finalAmt });
    await supabase.from('transactions').insert({
      user_id: order.executor_id, order_id: order.id,
      type: 'order_payout', amount: finalAmt, status: 'completed',
    });
    // Deposit is forfeited to executor (if any)
    if (depositAmt > 0) {
      await supabase.rpc('add_wallet_balance', { p_user_id: order.executor_id, p_amount: depositAmt });
      await supabase.from('transactions').insert({
        user_id: order.executor_id, order_id: order.id,
        type: 'deposit_forfeit', amount: depositAmt, status: 'completed',
      });
    }
  } else {
    // Full refund including deposit
    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
    await supabase.rpc('add_wallet_balance', { p_user_id: order.customer_id, p_amount: refAmt });
    await supabase.from('transactions').insert({
      user_id: order.customer_id, order_id: order.id,
      type: 'dispute_refund_customer', amount: refAmt, status: 'completed',
    });
  }

  // Optional bans
  if (ban_customer)  await supabase.from('profiles').update({ is_banned: true }).eq('id', order.customer_id);
  if (ban_executor)  await supabase.from('profiles').update({ is_banned: true }).eq('id', order.executor_id);

  sendTelegram(
    `⚖️ Спор разрешён\nЗаказ: ${order.id}\nРешение: ${normalised === 'pay_executor' ? 'выплатить исполнителю' : 'вернуть заказчику'}`
  );

  res.json({ success: true });
});

// ─── Contact-exchange orders ─────────────────────────────────

// GET /admin/contact-exchange-orders?status=
router.get('/contact-exchange-orders', async (req, res) => {
  const { status } = req.query;

  let q = supabase
    .from('orders')
    .select(`
      id, title, status, contact_exchange_reason, deposit_amount, created_at,
      customer:profiles!orders_customer_id_fkey(id, nickname),
      executor:profiles!orders_executor_id_fkey(id, nickname),
      conversations(id)
    `)
    .eq('requires_contact_exchange', true)
    .order('created_at', { ascending: false })
    .limit(200);

  if (status) q = q.eq('status', status);

  const { data: orders, error } = await q;
  if (error) return serverError(res, error);

  if (!orders?.length) return res.json([]);

  // Attach flagged message counts per conversation
  const convIds = orders.flatMap(o => (o.conversations ?? []).map(c => c.id));
  let flagCounts = {};
  if (convIds.length) {
    const { data: flags } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', convIds)
      .eq('is_contact_info', true);
    for (const f of (flags ?? [])) {
      flagCounts[f.conversation_id] = (flagCounts[f.conversation_id] ?? 0) + 1;
    }
  }

  res.json(orders.map(o => {
    const convId = o.conversations?.[0]?.id ?? null;
    return {
      ...o,
      conversation_id: convId,
      flagged_messages: convId ? (flagCounts[convId] ?? 0) : 0,
      conversations: undefined,
    };
  }));
});

// ─── Support tickets (admin) ─────────────────────────────────

// PATCH /admin/support/tickets/:id/close
router.patch('/support/tickets/:id/close', async (req, res) => {
  const { error } = await supabase
    .from('support_tickets')
    .update({ status: 'closed' })
    .eq('id', req.params.id)
    .neq('status', 'closed');
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// ─── Chat moderation ────────────────────────────────────────

// GET /admin/chat-moderation?reviewed=false|true
router.get('/chat-moderation', async (req, res) => {
  const { reviewed } = req.query;

  let q = supabase
    .from('messages')
    .select(`
      id, content, is_contact_info, ai_suspected, moderation_reviewed, created_at,
      sender:profiles!messages_sender_id_fkey(id, nickname),
      conversations!inner(id, order_id, orders!inner(id, title, order_type))
    `)
    .or('is_contact_info.eq.true,ai_suspected.eq.true')
    .order('created_at', { ascending: false })
    .limit(200);

  if (reviewed === 'false') q = q.eq('moderation_reviewed', false);
  else if (reviewed === 'true') q = q.eq('moderation_reviewed', true);

  const { data, error } = await q;
  if (error) return serverError(res, error);

  res.json((data ?? []).map(m => ({
    ...m,
    flag_source: m.is_contact_info ? 'regex' : 'ai',
  })));
});

// PATCH /admin/chat-moderation/:msgId/review
router.patch('/chat-moderation/:msgId/review', async (req, res) => {
  const { error } = await supabase
    .from('messages')
    .update({ moderation_reviewed: true })
    .eq('id', req.params.msgId);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// ─── Stats ──────────────────────────────────────────────────

// GET /admin/stats
router.get('/stats', async (req, res) => {
  const [
    totalUsersRes,
    bannedUsersRes,
    ordersRawRes,
    completedRes,
    openDisputesRes,
    openTicketsRes,
    confirmedDepositsRes,
  ] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_banned', true),
    supabase.from('orders').select('status').limit(2000),
    supabase.from('orders').select('final_amount, base_amount').eq('status', 'completed').limit(2000),
    supabase.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'answered']),
    supabase.from('deposit_requests').select('confirmed_amount, credited_amount').eq('status', 'confirmed').limit(2000),
  ]);

  const errs = [totalUsersRes, bannedUsersRes, ordersRawRes, completedRes, openDisputesRes, openTicketsRes, confirmedDepositsRes]
    .map((r, i) => r.error ? `[${i}] ${r.error.message}` : null).filter(Boolean);
  if (errs.length) console.error('[admin/stats] query errors:', errs.join(' | '));

  const orders_by_status = {};
  for (const o of (ordersRawRes.data ?? [])) {
    orders_by_status[o.status] = (orders_by_status[o.status] ?? 0) + 1;
  }

  const completed = completedRes.data ?? [];
  const total_commission_earned = Math.round(
    (confirmedDepositsRes.data ?? []).reduce(
      (s, d) => s + (parseFloat(d.confirmed_amount ?? 0) - parseFloat(d.credited_amount ?? 0)), 0
    ) * 100
  ) / 100;
  const total_volume = Math.round(
    completed.reduce((s, o) => s + parseFloat(o.final_amount ?? o.base_amount ?? 0), 0) * 100
  ) / 100;

  res.json({
    total_users:                totalUsersRes.count ?? 0,
    banned_users:               bannedUsersRes.count ?? 0,
    orders_by_status,
    total_commission_earned:    isNaN(total_commission_earned) ? 0 : total_commission_earned,
    total_volume:               isNaN(total_volume) ? 0 : total_volume,
    open_disputes_count:        openDisputesRes.count ?? 0,
    open_support_tickets_count: openTicketsRes.count ?? 0,
    pending_transactions_count: 0,
  });
});

// ─── Users ──────────────────────────────────────────────────

// GET /admin/users?search=&filter=all|banned|admins
router.get('/users', async (req, res) => {
  const { search, filter } = req.query;

  // Fetch auth users for emails via service-role admin API
  const { data: { users: authUsers }, error: authErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (authErr) return serverError(res, authErr);

  const emailMap = {};
  for (const u of (authUsers ?? [])) emailMap[u.id] = u.email ?? null;

  let q = supabase
    .from('profiles')
    .select('id, nickname, is_admin, is_banned, rating_as_customer, rating_as_executor, reviews_count_customer, reviews_count_executor, balance, created_at')
    .order('created_at', { ascending: false });

  if (filter === 'banned') q = q.eq('is_banned', true);
  else if (filter === 'admins') q = q.eq('is_admin', true);

  const { data: profiles, error } = await q;
  if (error) return serverError(res, error);

  let result = (profiles ?? []).map(p => ({ ...p, email: emailMap[p.id] ?? null }));

  if (search?.trim()) {
    const s = search.trim().toLowerCase();
    result = result.filter(p =>
      p.nickname?.toLowerCase().includes(s) || p.email?.toLowerCase().includes(s)
    );
  }

  res.json(result);
});

// PATCH /admin/users/:id — ban/unban or grant/revoke admin
router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { is_banned, is_admin } = req.body;

  // Prevent removing the last admin
  if (is_admin === false) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true)
      .neq('id', id);
    if ((count ?? 0) === 0) {
      return res.status(400).json({ error: 'Должен остаться хотя бы один администратор' });
    }
  }

  const updates = {};
  if (is_banned !== undefined) updates.is_banned = is_banned;
  if (is_admin  !== undefined) updates.is_admin  = is_admin;

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ error: 'No fields to update' });

  const { error } = await supabase.from('profiles').update(updates).eq('id', id);
  if (error) return serverError(res, error);

  res.json({ success: true });
});

// ─── Deposits ───────────────────────────────────────────────

// GET /admin/deposits?status=pending
router.get('/deposits', async (req, res) => {
  const { status } = req.query;
  let q = supabase
    .from('deposit_requests')
    .select(`id, claimed_amount, confirmed_amount, credited_amount, status, admin_comment, created_at,
      referral_bonus_applied, referral_bonus_amount,
      user:profiles!deposit_requests_user_id_fkey(
        id, nickname, referred_by, referral_qualifying_deposits_count
      )`)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return serverError(res, error);

  // PostgREST doesn't support self-referential nested embeds, so we resolve
  // referrer nicknames with a separate query.
  const referrerIds = [...new Set((data ?? []).map(d => d.user?.referred_by).filter(Boolean))];
  const referrerMap = {};
  if (referrerIds.length > 0) {
    const { data: referrers } = await supabase
      .from('profiles')
      .select('id, nickname')
      .in('id', referrerIds);
    for (const r of (referrers ?? [])) referrerMap[r.id] = r.nickname;
  }

  const result = (data ?? []).map(dep => ({
    ...dep,
    user: dep.user ? { id: dep.user.id, nickname: dep.user.nickname } : null,
    has_referrer:                       dep.user?.referred_by != null,
    referral_qualifying_deposits_count: dep.user?.referral_qualifying_deposits_count ?? 0,
    referrer_nickname:                  dep.user?.referred_by ? (referrerMap[dep.user.referred_by] ?? null) : null,
  }));

  res.json(result);
});

// POST /admin/deposits/:id/confirm
router.post('/deposits/:id/confirm', async (req, res) => {
  const { data: dep } = await supabase
    .from('deposit_requests')
    .select('id, status, user_id, claimed_amount')
    .eq('id', req.params.id)
    .single();

  if (!dep) return res.status(404).json({ error: 'Заявка не найдена' });
  if (dep.status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });

  const confirmedAmount = req.body.confirmed_amount != null
    ? parseFloat(req.body.confirmed_amount)
    : parseFloat(dep.claimed_amount);
  if (!confirmedAmount || confirmedAmount <= 0 || isNaN(confirmedAmount))
    return res.status(400).json({ error: 'Некорректная сумма подтверждения' });

  // Commission / referral parameters are admin-configurable via admin_settings;
  // fall back to the documented defaults (10% / 5% / 100₽) if a row is missing
  // or malformed so confirmation never breaks on bad config.
  const { data: settingsRows } = await supabase
    .from('admin_settings')
    .select('key, value')
    .in('key', ['deposit_commission_pct', 'referral_bonus_pct', 'referral_min_amount']);
  const settings = Object.fromEntries((settingsRows ?? []).map(r => [r.key, r.value]));
  const num = (key, fallback) => {
    const v = parseFloat(settings[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  const commissionPct = num('deposit_commission_pct', 10);
  const referralPct   = num('referral_bonus_pct', 5);
  const referralMin   = num('referral_min_amount', 100);

  const creditedAmount    = Math.round(confirmedAmount * (1 - commissionPct / 100) * 100) / 100;
  const platformGross     = Math.round(confirmedAmount * (commissionPct / 100) * 100) / 100;
  const now               = new Date().toISOString();

  // Referrer lookup — the final bonus decision is made atomically below via
  // claim_referral_bonus_slot (race-free, capped at referral_max_count).
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('nickname, referred_by')
    .eq('id', dep.user_id)
    .single();

  const referrerId    = userProfile?.referred_by ?? null;
  const referralBonus = Math.round(confirmedAmount * (referralPct / 100) * 100) / 100;
  const preEligible   = referrerId != null && confirmedAmount >= referralMin;

  // Atomic claim — prevents double-processing of this deposit
  const { data: claimed, error: claimErr } = await supabase
    .from('deposit_requests')
    .update({
      status:           'confirmed',
      confirmed_amount: confirmedAmount,
      credited_amount:  creditedAmount,
      processed_by:     req.userId,
      processed_at:     now,
    })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr) return serverError(res, claimErr, 'deposit:confirm:claim');
  if (!claimed || claimed.length === 0)
    return res.status(409).json({ error: 'Заявка уже обработана' });

  // Credit depositor's wallet
  await supabase.rpc('add_wallet_balance', { p_user_id: dep.user_id, p_amount: creditedAmount });
  await supabase.from('profiles').update({ last_deposit_confirmed_at: now }).eq('id', dep.user_id);

  // wallet_top achievement: 5000₽+ in cumulative topups
  const { data: topupProf } = await supabase.from('profiles').select('wallet_topup_total').eq('id', dep.user_id).single();
  const topupTotal = parseFloat(topupProf?.wallet_topup_total ?? 0) + confirmedAmount;
  await supabase.from('profiles').update({ wallet_topup_total: topupTotal }).eq('id', dep.user_id);
  if (topupTotal >= 5000) await grantAchievement(supabase, dep.user_id, 'wallet_top');

  // Atomically claim a referral-bonus slot. Returns true only if a slot was free
  // (count < cap), incrementing the counter under a row lock in the same call —
  // so concurrent confirms can never grant more than `referral_max_count` bonuses.
  let bonusApplied = false;
  if (preEligible) {
    const { data: slot } = await supabase.rpc('claim_referral_bonus_slot', { p_user_id: dep.user_id });
    bonusApplied = slot === true;
  }

  if (bonusApplied) {
    // deposit_referral: platform keeps gross 10%; net 5% after referral payout
    await supabase.from('transactions').insert({
      user_id:         dep.user_id,
      type:            'deposit_referral',
      amount:          creditedAmount,
      status:          'completed',
      platform_profit: platformGross,
      meta:            { referrer_id: referrerId, referrer_bonus: referralBonus, platform_profit_net: platformGross - referralBonus },
    });
    await supabase.from('deposit_requests')
      .update({ referral_bonus_applied: true, referral_bonus_amount: referralBonus })
      .eq('id', req.params.id);

    // Pay referral bonus
    await supabase.rpc('add_wallet_balance', { p_user_id: referrerId, p_amount: referralBonus });
    await supabase.rpc('add_referral_earnings', { p_user_id: referrerId, p_amount: referralBonus });
    await supabase.from('transactions').insert({
      user_id: referrerId,
      type:    'referral_bonus',
      amount:  referralBonus,
      status:  'completed',
      meta:    { from_user_id: dep.user_id, deposit_amount: confirmedAmount },
    });

    // referrer achievement: 3+ referred users with at least one qualifying deposit
    const { count: qualifyingReferrals } = await supabase
      .from('profiles').select('id', { count: 'exact', head: true })
      .eq('referred_by', referrerId).gt('referral_qualifying_deposits_count', 0);
    if ((qualifyingReferrals ?? 0) >= 3) await grantAchievement(supabase, referrerId, 'referrer');

    // Notify admin in Telegram
    const { data: referrerProfile } = await supabase.from('profiles').select('nickname').eq('id', referrerId).single();
    sendTelegram(
      `💰 Реферальный бонус\n` +
      `Реферер: @${referrerProfile?.nickname ?? referrerId} получил ${referralBonus} ₽\n` +
      `Депозит: ${confirmedAmount} ₽ от @${userProfile?.nickname ?? dep.user_id}`
    );
  } else {
    // Regular deposit: platform keeps full 10%
    await supabase.from('transactions').insert({
      user_id:         dep.user_id,
      type:            'deposit',
      amount:          creditedAmount,
      status:          'completed',
      platform_profit: platformGross,
    });
  }

  // Confirm notification
  sendTelegram(
    `✅ Пополнение подтверждено\n` +
    `Пользователь: @${userProfile?.nickname ?? dep.user_id}\n` +
    `Сумма: ${confirmedAmount} ₽ → зачислено: ${creditedAmount} ₽` +
    (bonusApplied ? `\n🎁 Реферальный бонус: ${referralBonus} ₽` : '')
  );

  res.json({ success: true, credited_amount: creditedAmount, referral_bonus: bonusApplied ? referralBonus : 0 });
});

// POST /admin/deposits/:id/reject
router.post('/deposits/:id/reject', async (req, res) => {
  const { admin_comment } = req.body;
  const { data: claimed, error } = await supabase
    .from('deposit_requests')
    .update({ status: 'rejected', admin_comment: admin_comment ?? null, processed_by: req.userId, processed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select('id');
  if (error) return serverError(res, error);
  if (!claimed || claimed.length === 0)
    return res.status(409).json({ error: 'Заявка уже обработана' });
  res.json({ success: true });
});

// ─── Withdrawals ─────────────────────────────────────────────

// GET /admin/withdrawals?status=pending
router.get('/withdrawals', async (req, res) => {
  const { status } = req.query;
  let q = supabase
    .from('withdrawal_requests')
    .select('id, amount, card_number, status, admin_comment, created_at, user:profiles!withdrawal_requests_user_id_fkey(id, nickname)')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// POST /admin/withdrawals/:id/confirm
router.post('/withdrawals/:id/confirm', async (req, res) => {
  const { data: wr } = await supabase
    .from('withdrawal_requests')
    .select('id, status, user_id, amount')
    .eq('id', req.params.id)
    .single();

  if (!wr) return res.status(404).json({ error: 'Заявка не найдена' });

  const { data: claimed, error } = await supabase
    .from('withdrawal_requests')
    .update({ status: 'confirmed', processed_by: req.userId, processed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select('id');
  if (error) return serverError(res, error);
  if (!claimed || claimed.length === 0)
    return res.status(409).json({ error: 'Заявка уже обработана' });

  // Balance was already deducted at withdrawal creation
  await supabase.from('transactions').insert({ user_id: wr.user_id, type: 'withdrawal', amount: parseFloat(wr.amount), status: 'completed' });

  res.json({ success: true });
});

// POST /admin/withdrawals/:id/reject
router.post('/withdrawals/:id/reject', async (req, res) => {
  const { admin_comment } = req.body;

  const { data: wr } = await supabase
    .from('withdrawal_requests')
    .select('id, status, user_id, amount')
    .eq('id', req.params.id)
    .single();

  if (!wr) return res.status(404).json({ error: 'Заявка не найдена' });

  const { data: claimed, error } = await supabase
    .from('withdrawal_requests')
    .update({ status: 'rejected', admin_comment: admin_comment ?? null, processed_by: req.userId, processed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select('id');
  if (error) return serverError(res, error);
  if (!claimed || claimed.length === 0)
    return res.status(409).json({ error: 'Заявка уже обработана' });

  // Refund the reserved balance
  await supabase.rpc('add_wallet_balance', { p_user_id: wr.user_id, p_amount: parseFloat(wr.amount) });

  res.json({ success: true });
});

// ─── All orders (admin overview) ────────────────────────────

// GET /admin/orders?status=&order_type=&search=&page=1&limit=50
router.get('/orders', async (req, res) => {
  const { status, order_type, search, page = 1, limit = 50 } = req.query;
  const pg  = Math.max(1, parseInt(page)  || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pg - 1) * lim;

  // Resolve search term to matching user IDs for nickname filter
  let userIdFilter = [];
  if (search?.trim()) {
    const { data: profiles } = await supabase
      .from('profiles').select('id').ilike('nickname', `%${search.trim()}%`).limit(100);
    userIdFilter = (profiles ?? []).map(p => p.id);
  }

  let q = supabase
    .from('orders')
    .select(`
      id, title, order_type, status, base_amount, final_amount, reserved_amount,
      deposit_amount, requires_contact_exchange, created_at, updated_at,
      customer:profiles!orders_customer_id_fkey(id, nickname),
      executor:profiles!orders_executor_id_fkey(id, nickname)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + lim - 1);

  if (status)     q = q.eq('status', status);
  if (order_type) q = q.eq('order_type', order_type);

  const s = sanitizeSearchTerm(search);
  if (s) {
    const orParts = [`title.ilike.%${s}%`, `description.ilike.%${s}%`];
    if (userIdFilter.length) {
      const ids = userIdFilter.join(',');
      orParts.push(`customer_id.in.(${ids})`, `executor_id.in.(${ids})`);
    }
    q = q.or(orParts.join(','));
  }

  const { data, error, count } = await q;
  if (error) return serverError(res, error);
  res.json({ orders: data ?? [], total: count ?? 0, page: pg, limit: lim });
});

// ─── All conversations (admin overview) ──────────────────────

// GET /admin/conversations?search=&type=&page=1&limit=50
router.get('/conversations', async (req, res) => {
  const { search, type, page = 1, limit = 50 } = req.query;
  const pg  = Math.max(1, parseInt(page)  || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pg - 1) * lim;

  // Resolve search to conv IDs via profiles / orders / tickets
  let searchConvIds = null; // null = no filter; [] = empty result
  if (search?.trim()) {
    const s = search.trim();
    const [profilesRes, ordersRes, ticketsRes] = await Promise.all([
      supabase.from('profiles').select('id').ilike('nickname', `%${s}%`).limit(100),
      supabase.from('orders').select('id').ilike('title', `%${s}%`).limit(100),
      supabase.from('support_tickets').select('id').ilike('subject', `%${s}%`).limit(100),
    ]);

    const ids = new Set();

    const userIds = (profilesRes.data ?? []).map(p => p.id);
    if (userIds.length) {
      const { data: cp } = await supabase
        .from('conversation_participants').select('conversation_id').in('user_id', userIds);
      (cp ?? []).forEach(c => ids.add(c.conversation_id));
    }

    const orderIds = (ordersRes.data ?? []).map(o => o.id);
    if (orderIds.length) {
      const { data: oc } = await supabase
        .from('conversations').select('id').in('order_id', orderIds);
      (oc ?? []).forEach(c => ids.add(c.id));
    }

    const ticketIds = (ticketsRes.data ?? []).map(t => t.id);
    if (ticketIds.length) {
      const { data: tc } = await supabase
        .from('conversations').select('id').in('support_ticket_id', ticketIds);
      (tc ?? []).forEach(c => ids.add(c.id));
    }

    searchConvIds = [...ids];
  }

  // If search returned no matches → return empty immediately
  if (searchConvIds !== null && searchConvIds.length === 0)
    return res.json({ conversations: [], total: 0, page: pg, limit: lim });

  let q = supabase
    .from('conversations')
    .select(`
      id, type, created_at, order_id, support_ticket_id,
      orders!conversations_order_id_fkey(id, title),
      support_tickets!conversations_support_ticket_id_fkey(id, subject),
      conversation_participants(user_id, profiles!conversation_participants_user_id_fkey(id, nickname))
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + lim - 1);

  if (type) q = q.eq('type', type);
  if (searchConvIds !== null) q = q.in('id', searchConvIds);

  const { data: convs, error, count } = await q;
  if (error) return serverError(res, error);

  const convIds = (convs ?? []).map(c => c.id);
  let lastMessages = {};
  let msgCounts   = {};

  if (convIds.length) {
    // Fetch recent messages for last-message preview and per-conv count
    const { data: msgs } = await supabase
      .from('messages')
      .select('conversation_id, content, created_at, sender:profiles!messages_sender_id_fkey(nickname)')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(Math.min(convIds.length * 20, 1000));

    for (const m of (msgs ?? [])) {
      msgCounts[m.conversation_id] = (msgCounts[m.conversation_id] ?? 0) + 1;
      if (!lastMessages[m.conversation_id]) lastMessages[m.conversation_id] = m;
    }
  }

  const result = (convs ?? []).map(c => ({
    id:                 c.id,
    type:               c.type,
    created_at:         c.created_at,
    order_id:           c.order_id,
    support_ticket_id:  c.support_ticket_id,
    order_title:        c.orders?.title ?? null,
    ticket_subject:     c.support_tickets?.subject ?? null,
    participants:       (c.conversation_participants ?? []).map(p => p.profiles ?? { id: p.user_id, nickname: '?' }),
    last_message:       lastMessages[c.id]
      ? { content: lastMessages[c.id].content, created_at: lastMessages[c.id].created_at, sender_nickname: lastMessages[c.id].sender?.nickname ?? 'Система' }
      : null,
    message_count: msgCounts[c.id] ?? 0,
  }));

  // Re-sort by last message time (newer message = higher in list)
  result.sort((a, b) =>
    new Date(b.last_message?.created_at ?? b.created_at) -
    new Date(a.last_message?.created_at ?? a.created_at)
  );

  res.json({ conversations: result, total: count ?? 0, page: pg, limit: lim });
});

// ─── Settings ───────────────────────────────────────────────

// PUT /admin/settings/:key  (site_settings — payment requisites etc.)
router.put('/settings/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value == null) return res.status(400).json({ error: 'value is required' });
  const { data, error } = await supabase
    .from('site_settings')
    .upsert({ key, value, updated_by: req.userId, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select().single();
  if (error) return serverError(res, error);
  res.json(data);
});

// PUT /admin/admin-settings/:key  (admin_settings — rates, prices)
router.put('/admin-settings/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value == null) return res.status(400).json({ error: 'value is required' });
  const { data, error } = await supabase
    .from('admin_settings')
    .upsert({ key, value: String(value), updated_by: req.userId, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select().single();
  if (error) return serverError(res, error);
  res.json(data);
});

// GET /admin/settings — all settings from both tables
router.get('/settings', async (req, res) => {
  const [siteRes, adminRes] = await Promise.all([
    supabase.from('site_settings').select('key, value'),
    supabase.from('admin_settings').select('key, value'),
  ]);
  const site  = {};
  for (const r of (siteRes.data  ?? [])) site[r.key]  = r.value;
  const admin = {};
  for (const r of (adminRes.data ?? [])) admin[r.key] = r.value;
  res.json({ site, admin });
});

// ─── Finance ─────────────────────────────────────────────────

// GET /admin/finance/summary
router.get('/finance/summary', async (req, res) => {
  const [txRes, balRes, expRes] = await Promise.all([
    supabase.from('transactions')
      .select('type, amount, platform_profit')
      .in('type', ['deposit', 'deposit_referral', 'referral_bonus', 'balance_to_token'])
      .eq('status', 'completed'),
    supabase.from('profiles').select('balance'),
    supabase.from('admin_settings').select('value').eq('key', 'platform_expenses').single(),
  ]);

  if (txRes.error) return serverError(res, txRes.error);

  const txs = txRes.data ?? [];
  const round2 = n => Math.round(n * 100) / 100;

  const commission_regular    = round2(txs.filter(t => t.type === 'deposit').reduce((s, t) => s + parseFloat(t.platform_profit ?? 0), 0));
  const commission_referral   = round2(txs.filter(t => t.type === 'deposit_referral').reduce((s, t) => s + parseFloat(t.platform_profit ?? 0), 0));
  const referral_bonuses_paid = round2(txs.filter(t => t.type === 'referral_bonus').reduce((s, t) => s + parseFloat(t.amount ?? 0), 0));
  const gost_tokens_revenue   = round2(txs.filter(t => t.type === 'balance_to_token').reduce((s, t) => s + parseFloat(t.platform_profit ?? 0), 0));
  const total_platform_profit = round2(commission_regular + commission_referral - referral_bonuses_paid + gost_tokens_revenue);
  const total_user_balances   = round2((balRes.data ?? []).reduce((s, p) => s + parseFloat(p.balance ?? 0), 0));
  const platform_expenses     = parseFloat(expRes.data?.value ?? '0');
  const available_to_withdraw = round2(total_platform_profit - platform_expenses);

  res.json({
    commission_regular,
    commission_referral,
    referral_bonuses_paid,
    gost_tokens_revenue,
    total_platform_profit,
    total_user_balances,
    platform_expenses,
    available_to_withdraw,
  });
});

// PATCH /admin/finance/expenses  { amount }
router.patch('/finance/expenses', async (req, res) => {
  const amount = parseFloat(req.body.amount);
  if (isNaN(amount) || amount < 0) return res.status(400).json({ error: 'Некорректная сумма' });
  const { error } = await supabase
    .from('admin_settings')
    .upsert({ key: 'platform_expenses', value: String(amount), updated_by: req.userId, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return serverError(res, error);
  res.json({ success: true, platform_expenses: amount });
});

// ─── Forum moderation (admin) ─────────────────────────────────

// GET /admin/forum/flagged
router.get('/forum/flagged', async (req, res) => {
  const { data, error } = await supabase
    .from('forum_posts')
    .select(`
      id, content, moderation_status, created_at,
      author:profiles!forum_posts_author_id_fkey(id, nickname, avatar_url),
      forum_moderation_log(ai_reason)
    `)
    .eq('moderation_status', 'flagged')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return serverError(res, error);
  res.json((data ?? []).map(post => ({
    ...post,
    moderation_reason: post.forum_moderation_log?.[0]?.ai_reason ?? null,
    forum_moderation_log: undefined,
  })));
});

// POST /admin/forum/posts/:id/approve
router.post('/forum/posts/:id/approve', async (req, res) => {
  const { error } = await supabase
    .from('forum_posts')
    .update({ moderation_status: 'approved' })
    .eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// DELETE /admin/forum/posts/:id  (soft delete)
router.delete('/forum/posts/:id', async (req, res) => {
  const { error } = await supabase
    .from('forum_posts')
    .update({ is_deleted: true, moderation_status: 'approved' })
    .eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// GET /admin/forum/reports
router.get('/forum/reports', async (req, res) => {
  const { data, error } = await supabase
    .from('forum_reports')
    .select(`
      id, reason, status, created_at,
      reporter:profiles!forum_reports_reporter_id_fkey(id, nickname),
      post:forum_posts!forum_reports_post_id_fkey(
        id, content, is_deleted,
        author:profiles!forum_posts_author_id_fkey(id, nickname)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// POST /admin/forum/reports/:id/resolve  { action: 'dismiss'|'delete_post' }
router.post('/forum/reports/:id/resolve', async (req, res) => {
  const { action } = req.body;
  const { data: report, error: fetchErr } = await supabase
    .from('forum_reports')
    .select('id, post_id')
    .eq('id', req.params.id)
    .single();
  if (fetchErr || !report) return res.status(404).json({ error: 'Жалоба не найдена' });

  if (action === 'delete_post') {
    await supabase.from('forum_posts').update({ is_deleted: true }).eq('id', report.post_id);
  }
  await supabase.from('forum_reports').update({ status: 'resolved' }).eq('id', req.params.id);
  res.json({ success: true });
});

// ─── Forum categories (admin) ─────────────────────────────────

// GET /admin/forum/categories
router.get('/forum/categories', async (req, res) => {
  const { data, error } = await supabase
    .from('forum_categories')
    .select('id, name, description, icon_name, sort_order, is_active')
    .order('sort_order');
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// POST /admin/forum/categories
router.post('/forum/categories', async (req, res) => {
  const { name, description, icon_name, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название категории' });
  const { data, error } = await supabase
    .from('forum_categories')
    .insert({ name: name.trim(), description: description ?? null, icon_name: icon_name ?? 'MessagesSquare', sort_order: sort_order ?? 99 })
    .select().single();
  if (error) return serverError(res, error);
  res.status(201).json(data);
});

// PATCH /admin/forum/categories/:id
router.patch('/forum/categories/:id', async (req, res) => {
  const { name, description, icon_name, sort_order, is_active } = req.body;
  const updates = {};
  if (name        !== undefined) updates.name        = name;
  if (description !== undefined) updates.description = description;
  if (icon_name   !== undefined) updates.icon_name   = icon_name;
  if (sort_order  !== undefined) updates.sort_order  = sort_order;
  if (is_active   !== undefined) updates.is_active   = is_active;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для обновления' });
  const { error } = await supabase.from('forum_categories').update(updates).eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// DELETE /admin/forum/categories/:id
router.delete('/forum/categories/:id', async (req, res) => {
  const { error } = await supabase.from('forum_categories').delete().eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

module.exports = router;
