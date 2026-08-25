const { Router } = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');
const { makeUploader } = require('../utils/upload');
const { withIsVip } = require('../utils/vip');
const { sendTelegram } = require('../utils/telegramNotify');
const { notifyUser } = require('../utils/notify');

const router = Router();
const upload = makeUploader();

// Admin write/read access via this router (as opposed to the dedicated
// /admin/conversations/*) is only meant for support tickets, where the admin
// is never added as a real conversation_participant — that's their job.
// Order chats are biржа-only: an admin who happens to also be the customer
// or executor gets in as that participant, same as anyone else, but a
// non-participant admin must go through the admin panel, not the market UI.
async function checkAccess(convId, userId) {
  const [{ data: participant }, { data: profile }, { data: conv }] = await Promise.all([
    supabase.from('conversation_participants').select('id').eq('conversation_id', convId).eq('user_id', userId).maybeSingle(),
    supabase.from('profiles').select('is_admin').eq('id', userId).single(),
    supabase.from('conversations').select('type').eq('id', convId).single(),
  ]);
  const isParticipant = participant != null;
  const isAdmin = profile?.is_admin === true;
  const allowed = isParticipant || (isAdmin && conv?.type === 'support_ticket');
  return { isParticipant, isAdmin, convType: conv?.type, allowed };
}

// GET /conversations/:id/messages?before=<timestamp>&limit=<n>
router.get('/:id/messages', auth, async (req, res) => {
  const { id: convId } = req.params;
  const { before, limit = 100 } = req.query;

  const { allowed } = await checkAccess(convId, req.userId);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  let q = supabase
    .from('messages')
    .select(`id, content, is_contact_info, moderation_reviewed, is_admin_message, created_at,
      sender:profiles!messages_sender_id_fkey(id, nickname, avatar_url, vip_expires_at),
      message_attachments(id, file_name, file_size)`)
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) return serverError(res, error);

  res.json((data ?? []).reverse().map(m => ({ ...m, sender: withIsVip(m.sender) }))); // oldest-first for display
});

// POST /conversations/:id/messages
router.post('/:id/messages', auth, upload.array('files', 5), async (req, res) => {
  const { id: convId } = req.params;
  const content = req.body.content?.trim() ?? '';
  const hasFiles = (req.files?.length ?? 0) > 0;

  if (!content && !hasFiles) return res.status(400).json({ error: 'content is required' });
  if (content.length > 5000) return res.status(400).json({ error: 'Сообщение слишком длинное' });

  const { isAdmin, allowed } = await checkAccess(convId, req.userId);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  // Get conversation details (type, order_type, support_ticket_id)
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, type, order_id, support_ticket_id, orders!conversations_order_id_fkey(order_type, status, requires_contact_exchange, is_hidden, hidden_reason)')
    .eq('id', convId)
    .single();

  // VIP expired and the linked order got auto-hidden — lock sending only
  // (reading history is unaffected, GET /:id/messages above has no such check).
  if (conv?.orders?.is_hidden && conv.orders.hidden_reason === 'vip_expired') {
    return res.status(403).json({ error: 'Чат заблокирован до продления VIP', code: 'VIP_EXPIRED_CHAT_LOCKED' });
  }

  // Order finished (delivered+confirmed or cancelled) — lock sending, history
  // stays readable. Post-completion support goes through /admin/conversations
  // instead, which has no such check.
  if (['completed', 'cancelled'].includes(conv?.orders?.status)) {
    return res.status(403).json({ error: 'Заказ завершён — чат закрыт для новых сообщений', code: 'ORDER_CLOSED_CHAT_LOCKED' });
  }

  // Blocked users can still message in support chats but not in order chats
  if (conv?.type !== 'support_ticket') {
    const { data: senderProfile } = await supabase.from('profiles').select('is_banned').eq('id', req.userId).single();
    if (senderProfile?.is_banned) {
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован. Обратитесь в поддержку.' });
    }
  }

  // ponytail: regex contact-info detection disabled per product decision —
  // hasContactInfo hardcoded false. Everything downstream (is_contact_info
  // column, the Telegram flag below, the frontend warning badge) still works
  // off this variable, so re-enabling is just restoring the detectContactInfo
  // call (see utils/contactDetector.js) here.
  const hasContactInfo = false;
  const contactWarning = false;

  const { data: msg, error: msgErr } = await supabase
    .from('messages')
    .insert({ conversation_id: convId, sender_id: req.userId, content, is_contact_info: hasContactInfo })
    .select()
    .single();

  if (msgErr) return serverError(res, msgErr);

  // Flagged for contact-info in a chat where it isn't sanctioned — same
  // notification treatment the forum's AI flags already get, so admins don't
  // have to poll /admin/chat-moderation to notice.
  if (contactWarning) {
    const { data: senderProf } = await supabase.from('profiles').select('nickname').eq('id', req.userId).single();
    sendTelegram(
      `🚩 Чат: подозрение на передачу контактов\n` +
      `Отправитель: @${senderProf?.nickname ?? req.userId}\n` +
      `Чат: ${convId}\n\n${content.slice(0, 300)}`
    );
  }

  // Upload files to chat-attachments bucket
  const attachments = [];
  const failedFiles = [];
  for (const file of (req.files ?? [])) {
    const storagePath = `${convId}/${uuidv4()}${path.extname(file.originalname)}`;
    const { error: upErr } = await supabase.storage
      .from('chat-attachments')
      .upload(storagePath, file.buffer, { contentType: file.mimetype });
    if (upErr) { failedFiles.push(file.originalname); continue; }

    const { data: att } = await supabase.from('message_attachments')
      .insert({ message_id: msg.id, file_path: storagePath, file_name: file.originalname, file_size: file.size })
      .select().single();
    if (att) attachments.push(att); else failedFiles.push(file.originalname);
  }

  // Support ticket status update
  if (conv?.type === 'support_ticket' && conv.support_ticket_id) {
    const ticketId = conv.support_ticket_id;
    if (isAdmin) {
      await supabase.from('support_tickets').update({ status: 'answered' }).eq('id', ticketId);
      const { data: ticket } = await supabase.from('support_tickets').select('user_id, subject').eq('id', ticketId).single();
      if (ticket?.user_id) {
        notifyUser(ticket.user_id, 'support_reply', 'Ответ в поддержке',
          ticket.subject ? `«${ticket.subject}»` : 'Вам ответили в поддержке', `/support/${ticketId}`);
      }
    } else {
      const { data: ticket } = await supabase.from('support_tickets').select('status').eq('id', ticketId).single();
      if (['answered', 'closed'].includes(ticket?.status)) {
        await supabase.from('support_tickets').update({ status: 'open' }).eq('id', ticketId);
      }
    }
  }

  res.status(201).json({ ...msg, message_attachments: attachments, contact_warning: contactWarning, failed_files: failedFiles });
});

// GET /conversations/:id/messages/:msgId/attachments/:attId/download
router.get('/:id/messages/:msgId/attachments/:attId/download', auth, async (req, res) => {
  const { id: convId, attId } = req.params;

  const { allowed } = await checkAccess(convId, req.userId);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

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

module.exports = router;
