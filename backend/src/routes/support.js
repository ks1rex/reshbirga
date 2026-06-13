const { Router } = require('express');
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();
router.use(auth);

// POST /support/tickets — create ticket + conversation + first message
router.post('/tickets', async (req, res) => {
  const { subject, message } = req.body;
  if (!subject?.trim()) return res.status(400).json({ error: 'subject is required' });
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
  if (subject.length > 200) return res.status(400).json({ error: 'Тема слишком длинная' });
  if (message.length > 5000) return res.status(400).json({ error: 'Сообщение слишком длинное' });

  const { data: ticket, error: tErr } = await supabase
    .from('support_tickets')
    .insert({ user_id: req.userId, subject: subject.trim(), status: 'open' })
    .select()
    .single();
  if (tErr) return serverError(res, tErr);

  const { data: conv, error: cErr } = await supabase
    .from('conversations')
    .insert({ type: 'support_ticket', support_ticket_id: ticket.id })
    .select()
    .single();
  if (cErr) return serverError(res, cErr);

  await supabase.from('conversation_participants').insert({
    conversation_id: conv.id,
    user_id: req.userId,
    role: 'support_user',
  });

  await supabase.from('messages').insert({
    conversation_id: conv.id,
    sender_id: req.userId,
    content: message.trim(),
    is_contact_info: false,
  });

  res.status(201).json({ ticket_id: ticket.id, conversation_id: conv.id });
});

// GET /support/tickets — user's own; admin + ?all=true → all tickets
router.get('/tickets', async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  const isAdmin = profile?.is_admin === true;

  const showAll = isAdmin && req.query.all === 'true';
  const { status } = req.query;

  let q = supabase
    .from('support_tickets')
    .select('id, subject, status, created_at, user:profiles!support_tickets_user_id_fkey(id, nickname)')
    .order('created_at', { ascending: false });

  if (!showAll) q = q.eq('user_id', req.userId);
  if (status) q = q.eq('status', status);

  const { data: tickets, error } = await q;
  if (error) return serverError(res, error);
  if (!tickets?.length) return res.json([]);

  // Attach conversation_id
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, support_ticket_id')
    .in('support_ticket_id', tickets.map(t => t.id));

  const convMap = {};
  for (const c of convs ?? []) convMap[c.support_ticket_id] = c.id;

  // Last message per conversation (batch)
  const convIds = Object.values(convMap);
  let lastMsgMap = {};
  if (convIds.length) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('conversation_id, content, created_at, sender:profiles!messages_sender_id_fkey(nickname)')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false });

    for (const m of msgs ?? []) {
      if (!lastMsgMap[m.conversation_id]) lastMsgMap[m.conversation_id] = m;
    }
  }

  res.json(tickets.map(t => {
    const cid = convMap[t.id] ?? null;
    const last = cid ? lastMsgMap[cid] ?? null : null;
    return {
      ...t,
      conversation_id: cid,
      last_message: last ? { content: last.content, created_at: last.created_at, sender_nickname: last.sender?.nickname } : null,
    };
  }));
});

// GET /support/tickets/:id — details (author or admin)
router.get('/tickets/:id', async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  const isAdmin = profile?.is_admin === true;

  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .select('id, subject, status, created_at, user:profiles!support_tickets_user_id_fkey(id, nickname)')
    .eq('id', req.params.id)
    .single();

  if (error || !ticket) return res.status(404).json({ error: 'Not found' });
  if (!isAdmin && ticket.user.id !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('support_ticket_id', ticket.id)
    .maybeSingle();

  res.json({ ...ticket, conversation_id: conv?.id ?? null });
});

// PATCH /support/tickets/:id/close — admin only
router.patch('/tickets/:id/close', async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', req.userId).single();
  if (!profile?.is_admin) return res.status(403).json({ error: 'Admin only' });

  const { error } = await supabase
    .from('support_tickets')
    .update({ status: 'closed' })
    .eq('id', req.params.id)
    .neq('status', 'closed');

  if (error) return serverError(res, error);
  res.json({ success: true });
});

module.exports = router;
