const { Router } = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { detectContactInfo } = require('../utils/contactDetector');
const { serverError } = require('../utils/httpError');
const { makeUploader } = require('../utils/upload');

const router = Router();
const upload = makeUploader();

async function checkAccess(convId, userId) {
  const [{ data: participant }, { data: profile }] = await Promise.all([
    supabase.from('conversation_participants').select('id').eq('conversation_id', convId).eq('user_id', userId).maybeSingle(),
    supabase.from('profiles').select('is_admin').eq('id', userId).single(),
  ]);
  return { isParticipant: participant != null, isAdmin: profile?.is_admin === true };
}

// GET /conversations/:id/messages?before=<timestamp>&limit=<n>
router.get('/:id/messages', auth, async (req, res) => {
  const { id: convId } = req.params;
  const { before, limit = 100 } = req.query;

  const { isParticipant, isAdmin } = await checkAccess(convId, req.userId);
  if (!isParticipant && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  let q = supabase
    .from('messages')
    .select(`id, content, is_contact_info, moderation_reviewed, created_at,
      sender:profiles!messages_sender_id_fkey(id, nickname, avatar_url),
      message_attachments(id, file_name, file_size)`)
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) return serverError(res, error);

  res.json((data ?? []).reverse()); // oldest-first for display
});

// POST /conversations/:id/messages
router.post('/:id/messages', auth, upload.array('files', 5), async (req, res) => {
  const { id: convId } = req.params;
  const content = req.body.content?.trim();

  if (!content) return res.status(400).json({ error: 'content is required' });
  if (content.length > 5000) return res.status(400).json({ error: 'Сообщение слишком длинное' });

  const { isParticipant, isAdmin } = await checkAccess(convId, req.userId);
  if (!isParticipant && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  // Get conversation details (type, order_type, support_ticket_id)
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, type, order_id, support_ticket_id, orders!conversations_order_id_fkey(order_type, requires_contact_exchange, is_hidden, hidden_reason)')
    .eq('id', convId)
    .single();

  // VIP expired and the linked order got auto-hidden — lock sending only
  // (reading history is unaffected, GET /:id/messages above has no such check).
  if (conv?.orders?.is_hidden && conv.orders.hidden_reason === 'vip_expired') {
    return res.status(403).json({ error: 'Чат заблокирован до продления VIP', code: 'VIP_EXPIRED_CHAT_LOCKED' });
  }

  // Blocked users can still message in support chats but not in order chats
  if (conv?.type !== 'support_ticket') {
    const { data: senderProfile } = await supabase.from('profiles').select('is_banned').eq('id', req.userId).single();
    if (senderProfile?.is_banned) {
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован. Обратитесь в поддержку.' });
    }
  }

  const requiresContactExchange = conv?.orders?.requires_contact_exchange ?? false;
  const hasContactInfo = detectContactInfo(content);
  // No warning if the order explicitly requires contact exchange — it's sanctioned
  const contactWarning = hasContactInfo && !requiresContactExchange;

  const { data: msg, error: msgErr } = await supabase
    .from('messages')
    .insert({ conversation_id: convId, sender_id: req.userId, content, is_contact_info: hasContactInfo })
    .select()
    .single();

  if (msgErr) return serverError(res, msgErr);

  // Upload files to chat-attachments bucket
  const attachments = [];
  for (const file of (req.files ?? [])) {
    const storagePath = `${convId}/${uuidv4()}${path.extname(file.originalname)}`;
    const { error: upErr } = await supabase.storage
      .from('chat-attachments')
      .upload(storagePath, file.buffer, { contentType: file.mimetype });
    if (upErr) continue;

    const { data: att } = await supabase.from('message_attachments')
      .insert({ message_id: msg.id, file_path: storagePath, file_name: file.originalname, file_size: file.size })
      .select().single();
    if (att) attachments.push(att);
  }

  // Support ticket status update
  if (conv?.type === 'support_ticket' && conv.support_ticket_id) {
    const ticketId = conv.support_ticket_id;
    if (isAdmin) {
      await supabase.from('support_tickets').update({ status: 'answered' }).eq('id', ticketId);
    } else {
      const { data: ticket } = await supabase.from('support_tickets').select('status').eq('id', ticketId).single();
      if (['answered', 'closed'].includes(ticket?.status)) {
        await supabase.from('support_tickets').update({ status: 'open' }).eq('id', ticketId);
      }
    }
  }

  res.status(201).json({ ...msg, message_attachments: attachments, contact_warning: contactWarning });
});

// GET /conversations/:id/messages/:msgId/attachments/:attId/download
router.get('/:id/messages/:msgId/attachments/:attId/download', auth, async (req, res) => {
  const { id: convId, attId } = req.params;

  const { isParticipant, isAdmin } = await checkAccess(convId, req.userId);
  if (!isParticipant && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

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
  res.json({ url: signed.signedUrl, filename: att.file_name });
});

module.exports = router;
