import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');

async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    },
  );
}

serve(async (req) => {
  const payload = await req.json().catch(() => null);
  if (!payload) return new Response('bad payload', { status: 400 });

  const { table, type, record } = payload;
  if (type !== 'INSERT') return new Response('ok', { status: 200 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (table === 'deposit_requests') {
    const { data: p } = await supabase
      .from('profiles').select('nickname').eq('id', record.user_id).single();
    await sendTelegram(
      `💰 Заявка на пополнение от ${p?.nickname ?? record.user_id}: ${record.claimed_amount} ₽`,
    );
  } else if (table === 'withdrawal_requests') {
    const { data: p } = await supabase
      .from('profiles').select('nickname').eq('id', record.user_id).single();
    await sendTelegram(
      `💸 Заявка на вывод от ${p?.nickname ?? record.user_id}: ${record.amount} ₽ на карту ${record.card_number}`,
    );
  }

  return new Response('ok', { status: 200 });
});
