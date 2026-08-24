// TELEGRAM_CHAT_ID accepts one id or several comma-separated ids — every
// recipient gets a DM from the bot, so each of them must have started a
// chat with it first (a group chat_id works too and only needs one entry).
async function sendTelegram(text) {
  const token   = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_ID ?? '963889378').split(',').map(id => id.trim()).filter(Boolean);
  // TEMP DIAGNOSTIC LOGGING — remove after diagnosing the missing-notification issue.
  console.log('[telegram][DIAG] sendTelegram called. has_token=', !!token, 'token_len=', token?.length, 'chat_ids=', chatIds, 'text=', text);
  if (!token) { console.log('[telegram][DIAG] no token set, returning early (silent no-op)'); return; }
  await Promise.all(chatIds.map(async chatId => {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id: chatId, text }),
        signal:  AbortSignal.timeout(10000),
      });
      const body = await resp.json().catch(() => ({}));
      console.log('[telegram][DIAG] chat_id=', chatId, 'response status=', resp.status, 'ok=', resp.ok, 'body=', JSON.stringify(body));
    } catch (err) {
      console.error('[telegram][DIAG] chat_id=', chatId, err?.message);
    }
  }));
}

module.exports = { sendTelegram };
