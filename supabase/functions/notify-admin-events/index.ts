import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
// chat_id админа; берём из секрета, иначе fallback на личный чат
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '963889378';

async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('[notify] missing secrets', { has_token: !!TELEGRAM_BOT_TOKEN, has_chat_id: !!TELEGRAM_CHAT_ID });
    return { sent: false, reason: 'missing_secrets' };
  }
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }) },
    );
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || body.ok === false) {
      console.error('[notify] telegram error', resp.status, body);
      return { sent: false, reason: 'telegram_error', status: resp.status, description: body.description ?? null };
    }
    return { sent: true };
  } catch (e) {
    console.error('[notify] fetch failed', String(e));
    return { sent: false, reason: 'fetch_failed', error: String(e) };
  }
}

serve(async (req) => {
  const payload = await req.json().catch(() => null);
  if (!payload) return new Response('bad payload', { status: 400 });

  if (payload.test === true) {
    const r = await sendTelegram('✅ Тестовое уведомление от бота birga');
    return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const { table, type, record } = payload;
  if (type !== 'INSERT') return new Response('ok', { status: 200 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let result: unknown = { sent: false, reason: 'unhandled_table' };

  if (table === 'deposit_requests') {
    const { data: p } = await supabase.from('profiles').select('nickname').eq('id', record.user_id).single();
    result = await sendTelegram(`💰 Заявка на пополнение от ${p?.nickname ?? record.user_id}: ${record.claimed_amount} ₽`);
  } else if (table === 'withdrawal_requests') {
    const { data: p } = await supabase.from('profiles').select('nickname').eq('id', record.user_id).single();
    result = await sendTelegram(`💸 Заявка на вывод от ${p?.nickname ?? record.user_id}: ${record.amount} ₽ на карту ${record.card_number}`);
  }

  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
