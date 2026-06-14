async function sendTelegram(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '963889378';
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text }),
      signal:  AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error('[telegram]', err?.message);
  }
}

module.exports = { sendTelegram };
