const supabase = require('../supabase_client');
const { sendUserTelegram } = require('./userTelegram');

// Сайтовое уведомление (колокольчик рядом с аватаркой) — не путать с
// sendTelegram (тот шлёт админу). Fire-and-forget: сбой не должен ронять
// основной запрос (списание/выплату/подтверждение), поэтому вызывающий код
// не await'ит и не проверяет ошибку.
//
// Дублирование в Telegram — только тем, кто явно привязал аккаунт
// (profiles.telegram_chat_id, см. routes/telegram.js); остальным ничего
// лишнего не летит.
async function notifyUser(userId, type, title, body, link) {
  if (!userId) return;
  const { error } = await supabase.from('notifications').insert({
    user_id: userId, type, title, body: body ?? null, link: link ?? null,
  });
  if (error) console.error('notifyUser failed:', type, error.message);

  const { data: prof } = await supabase.from('profiles')
    .select('telegram_chat_id').eq('id', userId).single();
  if (prof?.telegram_chat_id) {
    // FRONTEND_URL — это CORS-allowlist (несколько origin через запятую,
    // первый — ks1rex.github.io, не настоящий прод), для ссылки в уведомлении
    // нужен ровно один канонический адрес — SITE_URL (см. root CLAUDE.md
    // "Infrastructure": реальный прод — ebugubkin.ru с base '/', а не GitHub
    // Pages с base '/Ebu.Gubkin/', так что путь дописывать не нужно).
    const site = (process.env.SITE_URL || '').trim().replace(/\/$/, '');
    const fullLink = link && site ? `${site}${link}` : null;
    const text = [title, body, fullLink].filter(Boolean).join('\n\n');
    sendUserTelegram(prof.telegram_chat_id, text);
  }
}

module.exports = { notifyUser };
