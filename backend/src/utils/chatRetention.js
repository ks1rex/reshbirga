const supabase = require('../supabase_client');

const ATTACHMENT_MAX_AGE_DAYS = 180;
const CONVERSATION_MAX_AGE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

// Deletes chat-attachments storage objects (and their DB rows) belonging to
// messages older than 180 days — the message itself stays, only the file.
async function purgeOldAttachments() {
  const cutoff = new Date(Date.now() - ATTACHMENT_MAX_AGE_DAYS * DAY_MS).toISOString();
  const { data: rows } = await supabase
    .from('message_attachments')
    .select('id, file_path, messages!inner(created_at)')
    .lt('messages.created_at', cutoff);
  if (!rows?.length) return;

  const paths = rows.map(r => r.file_path);
  if (paths.length) await supabase.storage.from('chat-attachments').remove(paths);
  await supabase.from('message_attachments').delete().in('id', rows.map(r => r.id));
}

// Deletes whole conversations closed more than a year ago — messages/
// message_attachments cascade at the DB level, but Storage doesn't cascade
// so the chat-attachments objects must be removed first.
async function purgeOldConversations() {
  const cutoff = new Date(Date.now() - CONVERSATION_MAX_AGE_DAYS * DAY_MS).toISOString();
  const { data: convs } = await supabase
    .from('conversations').select('id').lt('closed_at', cutoff);
  if (!convs?.length) return;

  const convIds = convs.map(c => c.id);
  const { data: msgs } = await supabase.from('messages').select('id').in('conversation_id', convIds);
  if (msgs?.length) {
    const { data: atts } = await supabase.from('message_attachments')
      .select('file_path').in('message_id', msgs.map(m => m.id));
    const paths = (atts ?? []).map(a => a.file_path);
    if (paths.length) await supabase.storage.from('chat-attachments').remove(paths);
  }

  await supabase.from('conversations').delete().in('id', convIds);
}

async function runChatRetentionJob() {
  try { await purgeOldAttachments(); } catch (e) { console.error('[chatRetention] attachments', e.message); }
  try { await purgeOldConversations(); } catch (e) { console.error('[chatRetention] conversations', e.message); }
}

function startChatRetentionJob() {
  runChatRetentionJob();
  setInterval(runChatRetentionJob, 24 * 60 * 60 * 1000);
}

module.exports = { runChatRetentionJob, startChatRetentionJob };
