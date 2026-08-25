// Отправка в личный Telegram пользователя — отдельный бот от админского
// (TELEGRAM_USER_BOT_TOKEN, не TELEGRAM_BOT_TOKEN), тот же простой fetch-подход,
// что и telegramNotify.js.
async function sendUserTelegram(chatId, text) {
  const token = process.env.TELEGRAM_USER_BOT_TOKEN;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text }),
      signal:  AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error('[userTelegram] sendMessage failed:', err?.message);
  }
}

module.exports = { sendUserTelegram };
