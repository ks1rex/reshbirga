const supabase = require('../supabase_client');
const { sendTelegram } = require('./telegramNotify');

const SYSTEM_PROMPT = 'Ты модератор чата маркетплейса. Определи, пытается ли пользователь в этом сообщении ЗАМАСКИРОВАННО передать контактные данные (телефон, ник в соцсети/мессенджере, email, предложение общаться \'в другом месте\') — например, цифры написаны словами, через странные разделители, на другом языке/раскладке, или намёками. Ответь ТОЛЬКО JSON: {"suspicious": true, "reason": "краткая причина в 3-5 слов"} или {"suspicious": false}, без других пояснений.';

async function callDeepSeek(content, apiKey) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content },
      ],
      max_tokens: 40,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content ?? '').trim().replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(text);
  if (parsed.suspicious !== true) return { suspicious: false };
  return { suspicious: true, reason: (parsed.reason ?? '').trim().slice(0, 200) || null };
}

/**
 * Fire-and-forget: called after an order reaches a terminal status (completed/cancelled).
 * Skips orders that have a dispute (admin reviews those manually).
 * Checks each unchecked message against DeepSeek sequentially.
 */
async function runAIChatCheck(orderId) {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return;

    // (a) Skip if any dispute exists for this order — admin handles those manually
    const { count: disputeCount } = await supabase
      .from('disputes')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId);
    if ((disputeCount ?? 0) > 0) return;

    // (b) Find the order's conversation
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('order_id', orderId)
      .eq('type', 'order_chat')
      .maybeSingle();
    if (!conv) return;

    // Get messages not yet flagged by regex and not yet AI-checked; skip system messages
    const { data: messages } = await supabase
      .from('messages')
      .select('id, content')
      .eq('conversation_id', conv.id)
      .eq('is_contact_info', false)
      .is('ai_checked_at', null)
      .not('sender_id', 'is', null)
      .order('created_at', { ascending: true });

    if (!messages?.length) return;

    const now = new Date().toISOString();

    // (c-d) Check each message sequentially, update regardless of result
    const reasons = [];
    for (const msg of messages) {
      let result = { suspicious: false };
      try {
        result = (await callDeepSeek(msg.content, apiKey)) ?? { suspicious: false };
      } catch {
        // Network/parse error — mark as checked with suspicious=false
      }
      const updates = { ai_checked_at: now };
      if (result.suspicious) {
        updates.ai_suspected = true;
        updates.ai_reason = result.reason ?? null;
        reasons.push(result.reason || '—');
      }
      await supabase.from('messages').update(updates).eq('id', msg.id);
    }

    // One digest per order, not per message: this runs over a whole finished
    // chat at once, so per-message pings would arrive as a burst.
    if (reasons.length > 0) {
      sendTelegram(
        `🚩 Чат: AI-модерация\n` +
        `Заказ: ${orderId}\n` +
        `Подозрительных сообщений: ${reasons.length}\n` +
        reasons.map(r => `• ${r}`).join('\n') +
        `\n\nСм. Модерация в админке`
      );
    }
  } catch (err) {
    console.error('[aiChatCheck] Error for order', orderId, ':', err?.message ?? err);
  }
}

module.exports = { runAIChatCheck };
