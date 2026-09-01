const { Router } = require('express');
const auth = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');
const { sanitizeSearchTerm } = require('../utils/search');
const { sendTelegram } = require('../utils/telegramNotify');
const { grantAchievement } = require('../utils/reputation');
const { withIsVip, vipDiscountPct, applyVipDiscount, parseLevelDiscounts, VIP_LEVELS } = require('../utils/vip');
const { fetchAll, sumAll } = require('../utils/pagedFetch');
const { hideExcessForUser, baseListingLimit } = require('../utils/vipExpiry');
const scheduleWarmup = require('../jobs/scheduleWarmup');
const { notifyUser } = require('../utils/notify');
const { round2 } = require('../utils/commission');
const { closeOrderConversation, closeTicketConversation } = require('../utils/closeConversation');

const router = Router();
router.use(auth, adminMiddleware);

// Owner-only sections — everything not in the restricted admin's allowed set
// (споры/форум/заказы/модерация/поддержка/пользователи/2FA-настройки).
// Path-prefix gate, same pattern as the base auth/adminMiddleware above.
// Модерация категорий (заявки/approve/reject) намеренно оставлена доступной
// и рядовым админам, не только владельцам — поэтому /market-categories
// целиком убран из этого списка, а requireOwner навешан точечно на CRUD-
// роуты самих категорий (создать/переименовать/удалить) ниже.
router.use(
  ['/ledger', '/stats', '/deposits', '/withdrawals', '/settings', '/admin-settings', '/finance', '/vip', '/schedule-warmup'],
  adminMiddleware.requireOwner,
);

// GET /admin/ledger?type=&nickname=&date_from=&date_to=&page=1&limit=100
// Filters (including nickname) are applied in SQL, so pagination counts the
// *filtered* set — the old version fetched 500 newest rows and only then
// filtered by nickname in Node, which silently hid older matches.
router.get('/ledger', async (req, res) => {
  const { type, nickname, date_from, date_to } = req.query;
  const pg  = Math.max(1, parseInt(req.query.page) || 1);
  const lim = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = (pg - 1) * lim;

  // Nickname → user_id, in SQL. No match = empty result, not "no filter".
  let userIds = null;
  if (nickname?.trim()) {
    const { data: profs } = await supabase
      .from('profiles').select('id').ilike('nickname', `%${nickname.trim()}%`).limit(500);
    userIds = (profs ?? []).map(p => p.id);
    if (!userIds.length) return res.json({ entries: [], total: 0, page: pg, limit: lim });
  }

  let q = supabase
    .from('transactions')
    .select(`
      id, type, amount, status, created_at, order_id, platform_profit,
      user:profiles!transactions_user_id_fkey(id, nickname, vip_expires_at)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + lim - 1);

  if (type) q = q.eq('type', type);
  if (date_from) q = q.gte('created_at', date_from);
  if (date_to)   q = q.lte('created_at', date_to);
  if (userIds)   q = q.in('user_id', userIds);

  const { data, error, count } = await q;
  if (error) return serverError(res, error);

  const entries = (data ?? []).map(tx => ({ ...tx, user: withIsVip(tx.user) }));
  res.json({ entries, total: count ?? 0, page: pg, limit: lim });
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
    .select(`id, orders!inner(id, customer_id, executor_id, final_amount, reserved_amount, deposit_amount, commission_amount)`);

  if (claimErr) return serverError(res, claimErr, 'dispute:resolve:claim');
  if (!claimedRows?.length) return res.status(409).json({ error: 'Спор уже разрешён или не найден' });

  const order      = claimedRows[0].orders;
  const finalAmt   = Math.round(parseFloat(order.final_amount ?? order.reserved_amount) * 100) / 100;
  const depositAmt = Math.round(parseFloat(order.deposit_amount ?? 0) * 100) / 100;
  const refAmt     = Math.round(parseFloat(order.reserved_amount) * 100) / 100;

  if (normalised === 'pay_executor') {
    await supabase.from('orders').update({ status: 'completed', completed_at: now }).eq('id', order.id);
    // Executor gets final_amount (price) — на «заработанный» баланс; комиссия
    // биржи признаётся доходом здесь же, как и при обычном завершении заказа.
    await supabase.rpc('add_earned_balance', { p_user_id: order.executor_id, p_amount: finalAmt });
    await supabase.from('transactions').insert({
      user_id: order.executor_id, order_id: order.id,
      type: 'order_payout', amount: finalAmt, status: 'completed',
      platform_profit: Math.round(parseFloat(order.commission_amount ?? 0) * 100) / 100,
    });
    // Deposit is forfeited to executor (if any)
    if (depositAmt > 0) {
      await supabase.rpc('add_earned_balance', { p_user_id: order.executor_id, p_amount: depositAmt });
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
  closeOrderConversation(order.id).catch(() => {});

  // Optional bans — same rank check as PATCH /admin/users/:id: a regular
  // admin can't ban another admin/owner this way either.
  let bannableIds = new Set([order.customer_id, order.executor_id].filter(Boolean));
  if (!req.profile.is_owner && bannableIds.size) {
    const { data: admins } = await supabase
      .from('profiles').select('id').in('id', [...bannableIds]).eq('is_admin', true);
    for (const a of admins ?? []) bannableIds.delete(a.id);
  }
  if (ban_customer && bannableIds.has(order.customer_id))
    await supabase.from('profiles').update({ is_banned: true }).eq('id', order.customer_id);
  if (ban_executor && bannableIds.has(order.executor_id))
    await supabase.from('profiles').update({ is_banned: true }).eq('id', order.executor_id);

  sendTelegram(
    `⚖️ Спор разрешён\nЗаказ: ${order.id}\nРешение: ${normalised === 'pay_executor' ? 'выплатить исполнителю' : 'вернуть заказчику'}`
  );

  const disputeTitle = 'Спор по заказу разрешён';
  notifyUser(order.customer_id, 'dispute_resolved', disputeTitle,
    normalised === 'pay_executor' ? 'Администратор принял решение в пользу исполнителя' : 'Деньги возвращены на ваш баланс',
    `/market/orders/${order.id}`);
  notifyUser(order.executor_id, 'dispute_resolved', disputeTitle,
    normalised === 'pay_executor' ? 'Администратор принял решение в вашу пользу, деньги начислены' : 'Администратор принял решение в пользу заказчика',
    `/market/orders/${order.id}`);

  res.json({ success: true });
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
  closeTicketConversation(req.params.id).catch(() => {});
  res.json({ success: true });
});

// ─── Chat moderation ────────────────────────────────────────

// GET /admin/chat-moderation?reviewed=false|true
router.get('/chat-moderation', async (req, res) => {
  const { reviewed } = req.query;

  let q = supabase
    .from('messages')
    .select(`
      id, content, is_contact_info, ai_suspected, ai_reason, moderation_reviewed, created_at,
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
// Counts and sums cover *all* rows: the aggregates used to be capped at the
// newest 2000 orders / 2000 withdrawals, so the dashboard understated volume
// and commission as soon as the platform passed that mark. Row-scanning
// queries go through fetchAll (see utils/pagedFetch.js) — PostgREST truncates
// a single response at 1000 rows without erroring.
router.get('/stats', async (req, res) => {
  const nowIso = new Date().toISOString();
  const [
    totalUsersRes,
    bannedUsersRes,
    vipUsersRes,
    ordersRawRes,
    completedRes,
    openDisputesRes,
    openTicketsRes,
    withdrawalCommissionRes,
  ] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_banned', true),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).gt('vip_expires_at', nowIso),
    fetchAll(() => supabase.from('orders').select('status')),
    fetchAll(() => supabase.from('orders').select('final_amount, base_amount').eq('status', 'completed')),
    supabase.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'answered']),
    // Commission moved from deposit to withdrawal (stage 1) — deposits are 1:1 now,
    // so confirmed_amount - credited_amount on deposit_requests is always 0. Source
    // from transactions.platform_profit on completed withdrawals instead, matching
    // /admin/finance/summary's commission_regular. Плюс комиссия биржи, которая
    // пишется в platform_profit выплаты исполнителю (order_payout).
    sumAll(
      () => supabase.from('transactions').select('platform_profit').in('type', ['withdrawal', 'order_payout']).eq('status', 'completed'),
      'platform_profit',
    ),
  ]);

  const errs = [totalUsersRes, bannedUsersRes, vipUsersRes, ordersRawRes, completedRes, openDisputesRes, openTicketsRes, withdrawalCommissionRes]
    .map((r, i) => r.error ? `[${i}] ${r.error.message}` : null).filter(Boolean);
  if (errs.length) console.error('[admin/stats] query errors:', errs.join(' | '));

  const orders_by_status = {};
  for (const o of (ordersRawRes.data ?? [])) {
    orders_by_status[o.status] = (orders_by_status[o.status] ?? 0) + 1;
  }

  const completed = completedRes.data ?? [];
  const total_commission_earned = withdrawalCommissionRes.total ?? 0;
  const total_volume = Math.round(
    completed.reduce((s, o) => s + parseFloat(o.final_amount ?? o.base_amount ?? 0), 0) * 100
  ) / 100;

  res.json({
    total_users:                totalUsersRes.count ?? 0,
    banned_users:               bannedUsersRes.count ?? 0,
    vip_users:                  vipUsersRes.count ?? 0,
    orders_total:               (ordersRawRes.data ?? []).length,
    orders_by_status,
    total_commission_earned:    isNaN(total_commission_earned) ? 0 : total_commission_earned,
    total_volume:               isNaN(total_volume) ? 0 : total_volume,
    open_disputes_count:        openDisputesRes.count ?? 0,
    open_support_tickets_count: openTicketsRes.count ?? 0,
    pending_transactions_count: 0,
  });
});

// ─── Users ──────────────────────────────────────────────────

// GET /admin/users?search=&filter=all|banned|admins|vip&page=1&limit=50
// Everything — filter, search, paging — happens in SQL. The previous version
// loaded every profile row plus a 1000-user page of the GoTrue admin API on
// each request and filtered in Node; email comes off `profiles.email` (same
// column GET /profile reads), so no auth API call is needed at all.
router.get('/users', async (req, res) => {
  const { search, filter } = req.query;
  const pg  = Math.max(1, parseInt(req.query.page) || 1);
  const lim = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (pg - 1) * lim;

  let q = supabase
    .from('profiles')
    .select(`id, nickname, email, avatar_url, is_admin, is_owner, is_banned,
             rating_as_customer, rating_as_executor,
             reviews_count_customer, reviews_count_executor,
             level, reputation, balance, vip_expires_at, created_at`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + lim - 1);

  if (filter === 'banned')      q = q.eq('is_banned', true);
  else if (filter === 'admins') q = q.eq('is_admin', true);
  else if (filter === 'vip')    q = q.gt('vip_expires_at', new Date().toISOString());

  const s = sanitizeSearchTerm(search);
  if (s) q = q.or(`nickname.ilike.%${s}%,email.ilike.%${s}%`);

  const { data, error, count } = await q;
  if (error) return serverError(res, error);

  // Admins see the raw expiry date (unlike public profile views, which only get
  // the is_vip boolean via withIsVip) — they need it to answer "until when?".
  // is_owner is dropped entirely (not just masked to false) for non-owner
  // callers — a restricted admin must not be able to tell who's an owner.
  // email and balance are dropped the same way for non-owners — a
  // rank-and-file admin's job (disputes/moderation/support) never needs
  // either, and both are sensitive personal/financial data.
  const users = (data ?? []).map(p => {
    const { is_owner, email, balance, ...rest } = p;
    return {
      ...rest,
      ...(req.profile.is_owner ? { is_owner, email, balance } : {}),
      is_vip: !!p.vip_expires_at && new Date(p.vip_expires_at) > new Date(),
    };
  });

  res.json({ users, total: count ?? 0, page: pg, limit: lim });
});

// PATCH /admin/users/:id — ban/unban, or (owners only) grant/revoke admin/owner
router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { is_banned, is_admin, is_owner } = req.body;

  if ((is_admin !== undefined || is_owner !== undefined) && !req.profile.is_owner) {
    return res.status(403).json({ error: 'Требуются права владельца' });
  }

  // Rank-and-file admins may only ban/unban ordinary users — not other
  // admins, not owners. Owners can ban anyone.
  if (is_banned !== undefined && !req.profile.is_owner) {
    const { data: target } = await supabase.from('profiles').select('is_admin').eq('id', id).single();
    if (target?.is_admin) {
      return res.status(403).json({ error: 'Нельзя заблокировать администратора' });
    }
  }

  // Prevent removing the last admin / last owner
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
  if (is_owner === false || is_admin === false) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_owner', true)
      .neq('id', id);
    if ((count ?? 0) === 0) {
      return res.status(400).json({ error: 'Должен остаться хотя бы один владелец' });
    }
  }

  const updates = {};
  if (is_banned !== undefined) updates.is_banned = is_banned;
  if (is_admin  !== undefined) updates.is_admin  = is_admin;
  if (is_owner  !== undefined) updates.is_owner  = is_owner;

  // is_owner_was — постоянный маркер "когда-то был владельцем", отдельный от
  // is_owner: его не трогает самостоятельный тумблер «смотреть как админ»
  // (POST /profile/view-as-admin), только настоящая выдача/отзыв здесь, самим
  // владельцем. Отзыв админки целиком тоже гасит владельческое наследие —
  // нет смысла оставлять его тому, кто больше не админ вообще.
  if (is_owner === true)  updates.is_owner_was = true;
  if (is_owner === false) updates.is_owner_was = false;
  if (is_admin === false) { updates.is_owner = false; updates.is_owner_was = false; }

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

  // Atomic: claim + credit depositor + wallet_topup_total + referral bonus
  // (claim_referral_bonus_slot + payout + both ledger rows) all in one
  // transaction — see 20260716160000_confirm_deposit_request_atomic.sql for
  // why this replaced ~9 separate round-trips (partial-failure window between
  // "marked confirmed" and "actually credited").
  const { data: rpcRows, error: rpcError } = await supabase.rpc('confirm_deposit_request', {
    p_deposit_id: req.params.id,
    p_confirmed_amount: confirmedAmount,
    p_processed_by: req.userId,
  });
  if (rpcError) return serverError(res, rpcError, 'deposit:confirm:rpc');

  const result = rpcRows?.[0];
  if (!result?.out_success)
    return res.status(409).json({ error: 'Заявка уже обработана' });

  const creditedAmount = result.out_credited_amount;
  const bonusApplied   = result.out_bonus_applied;
  const referralBonus  = result.out_referral_bonus ?? 0;
  const referrerId     = result.out_referrer_id;

  const { data: userProfile } = await supabase.from('profiles').select('nickname').eq('id', dep.user_id).single();

  // wallet_top achievement: 5000₽+ in cumulative topups
  if (parseFloat(result.out_wallet_topup_total ?? 0) >= 5000) {
    await grantAchievement(supabase, dep.user_id, 'wallet_top');
  }

  if (bonusApplied) {
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
  }

  // Confirm notification
  sendTelegram(
    `✅ Пополнение подтверждено\n` +
    `Пользователь: @${userProfile?.nickname ?? dep.user_id}\n` +
    `Сумма: ${confirmedAmount} ₽ → зачислено: ${creditedAmount} ₽` +
    (bonusApplied ? `\n🎁 Реферальный бонус: ${referralBonus} ₽` : '')
  );

  notifyUser(dep.user_id, 'deposit_confirmed', 'Пополнение подтверждено',
    `Зачислено ${creditedAmount} ₽`, '/wallet');
  if (bonusApplied && referrerId) {
    notifyUser(referrerId, 'referral_bonus', 'Реферальный бонус начислен',
      `+${referralBonus} ₽ за пополнение приглашённого пользователя`, '/wallet');
  }

  res.json({ success: true, credited_amount: creditedAmount, referral_bonus: bonusApplied ? referralBonus : 0 });
});

// POST /admin/deposits/:id/reject
router.post('/deposits/:id/reject', async (req, res) => {
  const { admin_comment } = req.body;
  const { data: dep } = await supabase
    .from('deposit_requests').select('user_id').eq('id', req.params.id).single();
  const { data: claimed, error } = await supabase
    .from('deposit_requests')
    .update({ status: 'rejected', admin_comment: admin_comment ?? null, processed_by: req.userId, processed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select('id');
  if (error) return serverError(res, error);
  if (!claimed || claimed.length === 0)
    return res.status(409).json({ error: 'Заявка уже обработана' });

  if (dep?.user_id) {
    notifyUser(dep.user_id, 'deposit_rejected', 'Пополнение отклонено',
      admin_comment?.trim() || 'Заявка на пополнение отклонена администратором', '/wallet');
  }

  res.json({ success: true });
});

// ─── Withdrawals ─────────────────────────────────────────────

// Комиссия за вывод зависит от источника: занесённые деньги — ставка из
// admin_settings (15%), заработанные на бирже — 0%. Одна точка правды на
// бэкенде, фронт (админка и кошелёк) только показывает результат.
async function withdrawalCommissionPct(sourceBalance) {
  if (sourceBalance === 'earned') return 0;
  const { data } = await supabase
    .from('admin_settings').select('value').eq('key', 'withdrawal_commission_pct').maybeSingle();
  const pct = parseFloat(data?.value);
  return Number.isFinite(pct) ? pct : 15;
}

// GET /admin/withdrawals?status=pending
router.get('/withdrawals', async (req, res) => {
  const { status } = req.query;
  let q = supabase
    .from('withdrawal_requests')
    .select('id, amount, phone_number, bank_name, source_balance, status, admin_comment, created_at, user:profiles!withdrawal_requests_user_id_fkey(id, nickname)')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return serverError(res, error);

  const depositedPct = await withdrawalCommissionPct('deposited');
  res.json((data ?? []).map(w => {
    const pct    = w.source_balance === 'earned' ? 0 : depositedPct;
    const amount = parseFloat(w.amount ?? 0);
    return {
      ...w,
      commission_pct: pct,
      payout_amount: Math.round(amount * (1 - pct / 100) * 100) / 100,
    };
  }));
});

// POST /admin/withdrawals/:id/confirm
router.post('/withdrawals/:id/confirm', async (req, res) => {
  const { data: wr } = await supabase
    .from('withdrawal_requests')
    .select('id, status, user_id, amount, source_balance')
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

  // Commission is held on withdrawal now (deposits are credited 1:1). The actual
  // payout to the user (amount × (1 − pct)) happens manually by the admin/bank —
  // the reserved full `amount` was already deducted at withdrawal creation, and
  // platform_profit here just records the commission for the finance summary.
  // Ставка плоская и зависит только от источника: занесённый — 15%,
  // заработанный — 0% (прогрессии по уровню нет).
  const commissionPct  = await withdrawalCommissionPct(wr.source_balance);
  const amount         = parseFloat(wr.amount);
  const platformProfit = Math.round(amount * (commissionPct / 100) * 100) / 100;

  await supabase.from('transactions').insert({
    user_id:         wr.user_id,
    type:            'withdrawal',
    amount,
    status:          'completed',
    platform_profit: platformProfit,
  });

  notifyUser(wr.user_id, 'withdrawal_confirmed', 'Вывод средств выполнен',
    `Выплачено ${round2(amount * (1 - commissionPct / 100))} ₽`, '/wallet');

  res.json({ success: true });
});

// POST /admin/withdrawals/:id/reject
router.post('/withdrawals/:id/reject', async (req, res) => {
  const { admin_comment } = req.body;

  const { data: wr } = await supabase
    .from('withdrawal_requests')
    .select('id, status, user_id, amount, source_balance')
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

  // Refund the reserved balance — обратно в тот же баланс, откуда списали
  await supabase.rpc(wr.source_balance === 'earned' ? 'add_earned_balance' : 'add_wallet_balance',
    { p_user_id: wr.user_id, p_amount: parseFloat(wr.amount) });

  notifyUser(wr.user_id, 'withdrawal_rejected', 'Вывод средств отклонён',
    admin_comment?.trim() || 'Заявка на вывод отклонена, средства возвращены на баланс', '/wallet');

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
// Admin/Support.tsx reuses this same endpoint (type=support_ticket) for its
// own ticket list, so it can't be gated behind requireOwner outright — that
// broke support for rank-and-file admins. Instead, a non-owner is pinned to
// type=support_ticket regardless of what they pass: they keep ticket
// browsing (their job), but lose free browsing of every order chat.
router.get('/conversations', async (req, res) => {
  const { search, page = 1, limit = 50 } = req.query;
  const type = req.profile.is_owner ? req.query.type : 'support_ticket';
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
      support_tickets!conversations_support_ticket_id_fkey(id, subject, status),
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
    status:             c.support_tickets?.status ?? null,
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

// GET /admin/conversations/:id/messages?before=<timestamp>&limit=<n>
router.get('/conversations/:id/messages', async (req, res) => {
  const { id: convId } = req.params;
  const { before, limit = 100 } = req.query;

  let q = supabase
    .from('messages')
    .select(`id, content, is_contact_info, moderation_reviewed, is_admin_message, created_at,
      sender:profiles!messages_sender_id_fkey(id, nickname, avatar_url),
      message_attachments(id, file_name, file_size)`)
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) return serverError(res, error);

  res.json(data.reverse()); // oldest-first for display
});

// POST /admin/conversations/:id/messages
router.post('/conversations/:id/messages', async (req, res) => {
  const { id: convId } = req.params;
  const content = req.body.content?.trim();

  if (!content) return res.status(400).json({ error: 'content is required' });
  if (content.length > 5000) return res.status(400).json({ error: 'Сообщение слишком длинное' });

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, type, support_ticket_id')
    .eq('id', convId)
    .single();

  const { data: msg, error: msgErr } = await supabase
    .from('messages')
    .insert({ conversation_id: convId, sender_id: req.userId, content, is_admin_message: true })
    .select()
    .single();

  if (msgErr) return serverError(res, msgErr);

  if (conv?.type === 'support_ticket' && conv.support_ticket_id) {
    await supabase.from('support_tickets').update({ status: 'answered' }).eq('id', conv.support_ticket_id);
  }

  res.status(201).json(msg);
});

// GET /admin/conversations/:id/messages/:msgId/attachments/:attId/download
router.get('/conversations/:id/messages/:msgId/attachments/:attId/download', async (req, res) => {
  const { id: convId, attId } = req.params;

  const { data: att } = await supabase
    .from('message_attachments')
    .select('*, messages!inner(conversation_id)')
    .eq('id', attId)
    .single();

  if (!att || att.messages?.conversation_id !== convId)
    return res.status(404).json({ error: 'Attachment not found' });

  const { data: signed, error: signErr } = await supabase.storage
    .from('chat-attachments')
    .createSignedUrl(att.file_path, 300, { download: att.file_name });

  if (signErr) return serverError(res, signErr);
  res.json({ url: signed.signedUrl, filename: att.file_name });
});

// GET /admin/conversations/:id/messages/:msgId/attachments/:attId/preview
// Same as /download but no forced Content-Disposition, so images render inline via <img src>.
router.get('/conversations/:id/messages/:msgId/attachments/:attId/preview', async (req, res) => {
  const { id: convId, attId } = req.params;

  const { data: att } = await supabase
    .from('message_attachments')
    .select('*, messages!inner(conversation_id)')
    .eq('id', attId)
    .single();

  if (!att || att.messages?.conversation_id !== convId)
    return res.status(404).json({ error: 'Attachment not found' });

  const { data: signed, error: signErr } = await supabase.storage
    .from('chat-attachments')
    .createSignedUrl(att.file_path, 300);

  if (signErr) return serverError(res, signErr);
  res.json({ url: signed.signedUrl });
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

// Validation rules for admin_settings keys.
// ponytail: flat lookup table, add an entry here when adding a new tunable setting.
const ADMIN_SETTING_VALIDATORS = {
  withdrawal_commission_pct: 'percent',
  paritypay_commission_pct: 'percent',
  // наценка покупателю на бирже: +% сверх отображаемой цены, продавцу — цена целиком
  marketplace_commission_pct: 'percent',
  vip_token_discount_pct:    'percent',
  // 10 процентов через запятую — скидка на подписку для уровней 1..10
  vip_level_discounts:       'pct_list',
  referral_bonus_pct:        'percent',
  vip_duration_month_days:   'positive_int',
  vip_duration_year_days:    'positive_int',
  listing_limit_base:        'positive_int',
  listing_limit_vip:         'positive_int',
  referral_max_count:        'positive_int',
  vip_price_month:           'price',
  vip_price_year:            'price',
  gost_token_price:          'price',
  referral_min_amount:       'price',
  // 0 = автопрогрев выключен, иначе интервал в часах (см. jobs/scheduleWarmup.js)
  warmup_auto_hours:         'non_negative',
  // Показывается на главной вместо реального count(profiles) — пусто = показывать реальное число.
  homepage_users_count_override: 'non_negative_or_empty',
};

function validateAdminSettingValue(key, value) {
  const kind = ADMIN_SETTING_VALIDATORS[key];
  if (!kind) {
    return `Неизвестный ключ настройки. Допустимые ключи: ${Object.keys(ADMIN_SETTING_VALIDATORS).join(', ')}`;
  }
  // Список процентов проверяется до числовой проверки ниже: «0,10,20,...» —
  // не число, и общая ветка отвергла бы его.
  if (kind === 'pct_list') {
    const parts = String(value).split(',').map(p => p.trim());
    if (parts.length !== VIP_LEVELS)
      return `Нужно ровно ${VIP_LEVELS} значений через запятую — по одному на уровень`;
    for (const p of parts) {
      const n = Number(p);
      if (p === '' || !Number.isFinite(n) || n < 0 || n > 100)
        return 'Каждое значение — процент от 0 до 100';
    }
    return null;
  }

  if (kind === 'non_negative_or_empty' && String(value).trim() === '') return null;

  const num = Number(value);
  if (Number.isNaN(num)) return 'Значение должно быть числом';
  if (kind === 'percent' && (num < 0 || num > 100)) return 'Значение должно быть от 0 до 100';
  if (kind === 'positive_int' && (!Number.isInteger(num) || num <= 0)) return 'Значение должно быть положительным целым числом';
  if (kind === 'price' && num < 0) return 'Значение должно быть неотрицательным числом';
  if (kind === 'non_negative' && num < 0) return 'Значение должно быть неотрицательным числом';
  if (kind === 'non_negative_or_empty' && (!Number.isInteger(num) || num < 0)) return 'Значение должно быть неотрицательным целым числом или пустым';
  return null;
}

// PUT /admin/admin-settings/:key  (admin_settings — rates, prices)
router.put('/admin-settings/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value == null) return res.status(400).json({ error: 'value is required' });
  const validationError = validateAdminSettingValue(key, value);
  if (validationError) return res.status(400).json({ error: validationError });
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
// Both row scans (transactions, profile balances) page through fetchAll: a
// plain select silently stops at PostgREST's 1000-row cap, which quietly
// understated every figure on this page once the ledger passed that size.
router.get('/finance/summary', async (req, res) => {
  const [txRes, balRes, expRes, vipUsersRes] = await Promise.all([
    fetchAll(() => supabase.from('transactions')
      .select('type, amount, platform_profit')
      .in('type', ['withdrawal', 'deposit_referral', 'referral_bonus', 'balance_to_token', 'vip_purchase', 'order_payout'])
      .eq('status', 'completed')),
    fetchAll(() => supabase.from('profiles').select('balance')),
    supabase.from('admin_settings').select('value').eq('key', 'platform_expenses').single(),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).gt('vip_expires_at', new Date().toISOString()),
  ]);

  if (txRes.error) return serverError(res, txRes.error);

  const txs = txRes.data ?? [];
  const round2 = n => Math.round(n * 100) / 100;
  const sumBy = (type, col) => round2(txs.filter(t => t.type === type).reduce((s, t) => s + (parseFloat(t[col]) || 0), 0));

  // Commission moved from deposit to withdrawal (see admin_settings.withdrawal_commission_pct)
  const commission_regular    = sumBy('withdrawal', 'platform_profit');
  const commission_referral   = sumBy('deposit_referral', 'platform_profit');
  const referral_bonuses_paid = sumBy('referral_bonus', 'amount');
  const gost_tokens_revenue   = sumBy('balance_to_token', 'platform_profit');
  // VIP is bought out of wallet balance and never returns to the user, so the
  // whole charge is platform profit (purchase_vip writes platform_profit =
  // p_price). It was missing from this summary entirely.
  const vip_revenue           = sumBy('vip_purchase', 'platform_profit');
  const vip_purchases_count   = txs.filter(t => t.type === 'vip_purchase').length;
  // Комиссия биржи (+10% к цене для покупателя) пишется в platform_profit
  // выплаты исполнителю и признаётся в момент завершения сделки.
  const commission_marketplace = sumBy('order_payout', 'platform_profit');
  const total_platform_profit = round2(commission_regular + commission_referral - referral_bonuses_paid + gost_tokens_revenue + vip_revenue + commission_marketplace);
  const total_user_balances   = round2((balRes.data ?? []).reduce((s, p) => s + (parseFloat(p.balance) || 0), 0));
  const platform_expenses     = parseFloat(expRes.data?.value ?? '0');
  const available_to_withdraw = round2(total_platform_profit - platform_expenses);

  res.json({
    commission_regular,
    commission_marketplace,
    commission_referral,
    referral_bonuses_paid,
    gost_tokens_revenue,
    vip_revenue,
    vip_purchases_count,
    vip_active_count: vipUsersRes.count ?? 0,
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

// ─── VIP / подписки ──────────────────────────────────────────

// GET /admin/vip — всё про подписки одним ответом: тарифы, скидка по уровню,
// деньги и список действующих подписок.
//
// Скидка по уровню считается тем же vipDiscountPct, что применяется при покупке
// (routes/wallet.js), а не переписанной формулой — иначе таблица в админке
// разъехалась бы с реальной ценой при первой же правке правила.
router.get('/vip', async (req, res) => {
  const nowIso = new Date().toISOString();
  const soonIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const [settingsRes, txRes, subsRes, expiringRes] = await Promise.all([
    supabase.from('admin_settings').select('key, value')
      .in('key', ['vip_price_month', 'vip_price_year', 'vip_duration_month_days',
                  'vip_duration_year_days', 'vip_token_discount_pct', 'vip_level_discounts']),
    fetchAll(() => supabase.from('transactions')
      .select('amount, platform_profit, created_at')
      .eq('type', 'vip_purchase').eq('status', 'completed')),
    fetchAll(() => supabase.from('profiles')
      .select('id, nickname, avatar_url, level, vip_expires_at')
      .gt('vip_expires_at', nowIso)
      .order('vip_expires_at', { ascending: true })),
    supabase.from('profiles').select('id', { count: 'exact', head: true })
      .gt('vip_expires_at', nowIso).lt('vip_expires_at', soonIso),
  ]);

  if (txRes.error)   return serverError(res, txRes.error,   'admin:vip:transactions');
  if (subsRes.error) return serverError(res, subsRes.error, 'admin:vip:subscribers');

  const settings = Object.fromEntries((settingsRes.data ?? []).map(r => [r.key, r.value]));
  const num = (key, fallback) => {
    const n = parseFloat(settings[key]);
    return Number.isFinite(n) ? n : fallback;
  };

  const monthBase = num('vip_price_month', 300);
  const yearBase  = num('vip_price_year', 1500);
  const levelDiscounts = parseLevelDiscounts(settings.vip_level_discounts);

  const txs = txRes.data ?? [];
  const round2 = n => Math.round(n * 100) / 100;

  res.json({
    plans: {
      month: { base_price: monthBase, days: num('vip_duration_month_days', 30) },
      year:  { base_price: yearBase,  days: num('vip_duration_year_days', 365) },
    },
    gost_token_discount_pct: num('vip_token_discount_pct', 0),
    // 1..10 — те же уровни, что выдаёт utils/reputation.js
    level_discounts: Array.from({ length: VIP_LEVELS }, (_, i) => {
      const level = i + 1;
      return {
        level,
        discount_pct: vipDiscountPct(level, levelDiscounts),
        month_price: applyVipDiscount(monthBase, level, levelDiscounts),
        year_price:  applyVipDiscount(yearBase, level, levelDiscounts),
      };
    }),
    revenue:         round2(txs.reduce((s, t) => s + (parseFloat(t.platform_profit) || 0), 0)),
    purchases_count: txs.length,
    active_count:    (subsRes.data ?? []).length,
    expiring_week_count: expiringRes.count ?? 0,
    subscribers:     subsRes.data ?? [],
  });
});

// POST /admin/vip/:userId/extend  { days }
//
// Выдать или продлить подписку вручную — без списания с баланса: это подарок
// или компенсация, а не покупка, поэтому в transactions ничего не пишется
// (иначе выручка VIP в «Финансах» раздулась бы деньгами, которых не было).
// След остаётся в Telegram — тот же канал, что для подтверждений пополнений
// и решений по спорам.
//
// ponytail: read-then-update, а не RPC. Ручная правка подписки — редкая
// одиночная операция администратора; при двух одновременных продлениях одно
// потеряется. Понадобится вести это одновременно из нескольких мест — переносить
// в SQL-функцию рядом с purchase_vip.
router.post('/vip/:userId/extend', async (req, res) => {
  const days = parseInt(req.body?.days, 10);
  if (!Number.isFinite(days) || days < 1 || days > 3650)
    return res.status(400).json({ error: 'Число дней — от 1 до 3650' });

  const { data: profile, error: findError } = await supabase
    .from('profiles').select('nickname, vip_expires_at').eq('id', req.params.userId).maybeSingle();
  if (findError) return serverError(res, findError, 'admin:vip:extend:lookup');
  if (!profile) return res.status(404).json({ error: 'Пользователь не найден' });

  // Дни прибавляются к остатку, как в purchase_vip: истёкшая (или отсутствующая)
  // подписка считается от «сейчас», активная — от своей даты окончания.
  const now = Date.now();
  const from = Math.max(now, profile.vip_expires_at ? new Date(profile.vip_expires_at).getTime() : 0);
  const newExpiry = new Date(from + days * 86400000).toISOString();

  const { error } = await supabase
    .from('profiles').update({ vip_expires_at: newExpiry }).eq('id', req.params.userId);
  if (error) return serverError(res, error, 'admin:vip:extend');

  sendTelegram(
    `👑 VIP выдан вручную\n` +
    `Пользователь: @${profile.nickname ?? req.params.userId}\n` +
    `Дней: ${days}, подписка до ${new Date(newExpiry).toLocaleString('ru-RU')}\n` +
    `Без списания с баланса.`
  );

  res.json({ success: true, vip_expires_at: newExpiry });
});

// POST /admin/vip/:userId/cancel — снять подписку сейчас
router.post('/vip/:userId/cancel', async (req, res) => {
  const { data: profile, error: findError } = await supabase
    .from('profiles').select('nickname, vip_expires_at').eq('id', req.params.userId).maybeSingle();
  if (findError) return serverError(res, findError, 'admin:vip:cancel:lookup');
  if (!profile) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!profile.vip_expires_at || new Date(profile.vip_expires_at) <= new Date())
    return res.status(400).json({ error: 'Активной подписки нет' });

  // Ставим «истекла сейчас», а не null: часовой сторож (utils/vipExpiry.js)
  // ищет именно непустую дату в прошлом, и с null пользователь никогда бы
  // не попал под проверку лимита объявлений.
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('profiles').update({ vip_expires_at: now }).eq('id', req.params.userId);
  if (error) return serverError(res, error, 'admin:vip:cancel');

  // Не ждём часового прогона: сразу прячем то, что не влезает в базовый лимит.
  let hidden = 0;
  try {
    hidden = await hideExcessForUser(req.params.userId, await baseListingLimit());
  } catch (e) {
    // Подписка уже снята — сторож доберёт лишние объявления в течение часа.
    console.error('[admin:vip:cancel:hide]', e?.message);
  }

  sendTelegram(
    `👑 VIP снят администратором\n` +
    `Пользователь: @${profile.nickname ?? req.params.userId}\n` +
    `Скрыто объявлений сверх лимита: ${hidden}\n` +
    `Деньги не возвращаются автоматически.`
  );

  res.json({ success: true, vip_expires_at: now, hidden_items: hidden });
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
    .select('id, name, description, icon_name, icon_url, sort_order, is_active')
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
  const { name, description, icon_name, icon_url, sort_order, is_active } = req.body;
  const updates = {};
  if (name        !== undefined) updates.name        = name;
  if (description !== undefined) updates.description = description;
  if (icon_name   !== undefined) updates.icon_name   = icon_name;
  if (icon_url    !== undefined) updates.icon_url    = icon_url;
  if (sort_order  !== undefined) updates.sort_order  = sort_order;
  if (is_active   !== undefined) updates.is_active   = is_active;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для обновления' });
  const { error } = await supabase.from('forum_categories').update(updates).eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// POST /admin/forum/categories/:id/icon — кастомная картинка вместо эмодзи.
// Ужимать не нужно: лимит бакета 2 МБ уже отсекает то, что не подходит для
// иконки 40×40–56×56 в интерфейсе.
const iconUpload = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      const e = new Error('Допустимы только изображения (jpeg/png/webp/gif)');
      e.status = 400;
      return cb(e);
    }
    cb(null, true);
  },
}).single('file');

router.post('/forum/categories/:id/icon', (req, res) => {
  iconUpload(req, res, async (err) => {
    if (err) return res.status(err.status ?? 400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Файл не передан' });

    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[req.file.mimetype];
    const path = `${req.params.id}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('forum-icons')
      .upload(path, req.file.buffer, { contentType: req.file.mimetype });
    if (upErr) return serverError(res, upErr);

    const { data: { publicUrl } } = supabase.storage.from('forum-icons').getPublicUrl(path);
    const { error } = await supabase.from('forum_categories').update({ icon_url: publicUrl }).eq('id', req.params.id);
    if (error) return serverError(res, error);

    res.json({ icon_url: publicUrl });
  });
});

// DELETE /admin/forum/categories/:id
router.delete('/forum/categories/:id', async (req, res) => {
  const { error } = await supabase.from('forum_categories').delete().eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// ─── Market categories (admin) — фильтры "Учёба", "Другое" и т.д. ─────────
// у заказов/объявлений (market_categories, 0025). id — произвольный text PK,
// на создании генерируется, т.к. orders.category/listings.category хранят
// его как обычный текст без FK — переименование категории не ломает связи.

// GET /admin/market-categories
router.get('/market-categories', async (req, res) => {
  const { data, error } = await supabase
    .from('market_categories')
    .select('id, name, icon, sort_order')
    .order('sort_order');
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// POST /admin/market-categories
router.post('/market-categories', adminMiddleware.requireOwner, async (req, res) => {
  const { name, icon, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название категории' });
  const { data, error } = await supabase
    .from('market_categories')
    .insert({ id: require('crypto').randomUUID(), name: name.trim(), icon: icon || null, sort_order: sort_order ?? 99 })
    .select().single();
  if (error) return serverError(res, error);
  res.status(201).json(data);
});

// ─── Market category requests (owner) — заявки на новые категории от
// пользователей, заведённые при создании заказа/услуги с незнакомым
// названием (см. utils/marketCategories.js). Роуты объявлены раньше
// PATCH/DELETE /market-categories/:id — иначе Express принял бы "requests"
// за :id.

// GET /admin/market-categories/requests?status=pending
router.get('/market-categories/requests', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const { data, error } = await supabase
    .from('market_category_requests')
    .select(`id, name, status, reject_reason, created_at, reviewed_at,
      target_order_id, target_listing_id,
      requester:profiles!market_category_requests_requested_by_fkey(id, nickname, profile_slug),
      order:orders!market_category_requests_target_order_id_fkey(id, title),
      listing:listings!market_category_requests_target_listing_id_fkey(id, title)`)
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) return serverError(res, error);
  res.json(data ?? []);
});

// POST /admin/market-categories/requests/:id/approve
router.post('/market-categories/requests/:id/approve', async (req, res) => {
  const { data: reqRow } = await supabase.from('market_category_requests').select('*').eq('id', req.params.id).single();
  if (!reqRow) return res.status(404).json({ error: 'Заявка не найдена' });
  if (reqRow.status !== 'pending') return res.status(400).json({ error: 'Заявка уже рассмотрена' });

  const { data: existing } = await supabase.from('market_categories').select('id').ilike('name', reqRow.name).maybeSingle();
  if (!existing) {
    const { error: catErr } = await supabase.from('market_categories')
      .insert({ id: require('crypto').randomUUID(), name: reqRow.name, icon: null, sort_order: 99 });
    if (catErr) return serverError(res, catErr, 'market-categories:approve');
  }

  const { error } = await supabase.from('market_category_requests')
    .update({ status: 'approved', reviewed_by: req.userId, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) return serverError(res, error);

  notifyUser(reqRow.requested_by, 'category_approved', 'Новая категория принята',
    `«${reqRow.name}» теперь доступна всем в списке категорий`, undefined);

  res.json({ success: true });
});

// POST /admin/market-categories/requests/:id/reject  { reassign_to_id }
router.post('/market-categories/requests/:id/reject', async (req, res) => {
  const { reassign_to_id, reason } = req.body;
  const { data: reqRow } = await supabase.from('market_category_requests').select('*').eq('id', req.params.id).single();
  if (!reqRow) return res.status(404).json({ error: 'Заявка не найдена' });
  if (reqRow.status !== 'pending') return res.status(400).json({ error: 'Заявка уже рассмотрена' });

  let reassignName = null;
  if (reassign_to_id) {
    const { data: cat } = await supabase.from('market_categories').select('name').eq('id', reassign_to_id).maybeSingle();
    if (!cat) return res.status(400).json({ error: 'Категория для переноса не найдена' });
    reassignName = cat.name;
    if (reqRow.target_order_id) await supabase.from('orders').update({ category: reassignName }).eq('id', reqRow.target_order_id);
    if (reqRow.target_listing_id) await supabase.from('listings').update({ category: reassignName }).eq('id', reqRow.target_listing_id);
  }

  const { error } = await supabase.from('market_category_requests')
    .update({ status: 'rejected', reject_reason: reason || null, reviewed_by: req.userId, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) return serverError(res, error);

  notifyUser(reqRow.requested_by, 'category_rejected', 'Новая категория не принята',
    reassignName ? `«${reqRow.name}» не подошла — заказ/услуга переставлены на «${reassignName}»` : `«${reqRow.name}» не подошла`, undefined);

  res.json({ success: true });
});

// PATCH /admin/market-categories/:id
router.patch('/market-categories/:id', adminMiddleware.requireOwner, async (req, res) => {
  const { name, icon, sort_order } = req.body;
  const updates = {};
  if (name       !== undefined) updates.name       = name;
  if (icon       !== undefined) updates.icon       = icon;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Нет полей для обновления' });
  const { error } = await supabase.from('market_categories').update(updates).eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// DELETE /admin/market-categories/:id
router.delete('/market-categories/:id', adminMiddleware.requireOwner, async (req, res) => {
  const { error } = await supabase.from('market_categories').delete().eq('id', req.params.id);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// GET /admin/schedule-warmup/status
router.get('/schedule-warmup/status', async (req, res) => {
  const state = await scheduleWarmup.getState();
  res.json(state);
});

// POST /admin/schedule-warmup/start  { force?: boolean }
// force=true ignores schedule_cache and re-fetches everything; default resumes
// (skips keys that are still warm).
router.post('/schedule-warmup/start', async (req, res) => {
  const state = await scheduleWarmup.getState();
  if (state?.status === 'running' || state?.status === 'waiting_captcha') {
    return res.status(400).json({ error: 'Уже выполняется' });
  }
  scheduleWarmup.startWarmup({ force: req.body?.force === true }); // не ждём завершения
  res.json({ started: true });
});

// POST /admin/schedule-warmup/reset — unwedge a stuck 'running'/'waiting_captcha'
router.post('/schedule-warmup/reset', async (req, res) => {
  await scheduleWarmup.resetWarmup();
  res.json({ reset: true });
});

// POST /admin/schedule-warmup/solve-captcha  { answer }
router.post('/schedule-warmup/solve-captcha', async (req, res) => {
  const { answer } = req.body;
  if (!answer) return res.status(400).json({ error: 'Укажите answer' });
  try {
    const result = await scheduleWarmup.submitCaptchaAndContinue(answer);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /admin/schedule-warmup/cancel
router.post('/schedule-warmup/cancel', async (req, res) => {
  scheduleWarmup.cancelWarmup();
  res.json({ cancelled: true });
});

module.exports = router;
