const supabase = require('../supabase_client');

// Сайтовое уведомление (колокольчик рядом с аватаркой) — не путать с
// sendTelegram (тот шлёт админу). Fire-and-forget: сбой не должен ронять
// основной запрос (списание/выплату/подтверждение), поэтому вызывающий код
// не await'ит и не проверяет ошибку.
async function notifyUser(userId, type, title, body, link) {
  if (!userId) return;
  const { error } = await supabase.from('notifications').insert({
    user_id: userId, type, title, body: body ?? null, link: link ?? null,
  });
  if (error) console.error('notifyUser failed:', type, error.message);
}

module.exports = { notifyUser };
