async function sendTelegram(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '963889378';
  // TEMP DIAGNOSTIC LOGGING — remove after diagnosing the missing-notification issue.
  console.log('[telegram][DIAG] sendTelegram called. has_token=', !!token, 'token_len=', token?.length, 'chat_id=', chatId, 'text=', text);
  if (!token) { console.log('[telegram][DIAG] no token set, returning early (silent no-op)'); return; }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text }),
      signal:  AbortSignal.timeout(10000),
    });
    const body = await resp.json().catch(() => ({}));
    console.log('[telegram][DIAG] response status=', resp.status, 'ok=', resp.ok, 'body=', JSON.stringify(body));
  } catch (err) {
    console.error('[telegram][DIAG]', err?.message);
  }
}

module.exports = { sendTelegram };
