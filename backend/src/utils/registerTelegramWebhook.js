// Регистрирует вебхук пользовательского Telegram-бота при старте сервера —
// идемпотентно (Telegram просто перезаписывает URL при повторном вызове),
// поэтому безопасно дёргать на каждый деплой/рестарт. Нужен, чтобы не
// настраивать это руками через curl после каждого редеплоя на Render.
async function registerTelegramWebhook() {
  const token  = process.env.TELEGRAM_USER_BOT_TOKEN;
  const base   = process.env.TELEGRAM_WEBHOOK_URL; // публичный URL бэкенда, напр. https://xxx.onrender.com
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !base) return;

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        url: `${base.replace(/\/$/, '')}/telegram/webhook`,
        ...(secret ? { secret_token: secret } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await resp.json().catch(() => ({}));
    if (!body.ok) console.error('[telegram] setWebhook failed:', JSON.stringify(body));
  } catch (err) {
    console.error('[telegram] setWebhook request failed:', err?.message);
  }
}

module.exports = { registerTelegramWebhook };
