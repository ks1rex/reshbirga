const { Router } = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');
const { sendUserTelegram } = require('../utils/userTelegram');

const router = Router();

const LINK_TTL_MS = 15 * 60 * 1000;
const BOT_USERNAME = process.env.TELEGRAM_USER_BOT_USERNAME;

// POST /telegram/link — выдаёт одноразовый код + deep-link на бота.
router.post('/link', auth, async (req, res) => {
  if (!BOT_USERNAME) return res.status(503).json({ error: 'Telegram-бот не настроен' });

  const code = crypto.randomBytes(6).toString('hex');
  const expires_at = new Date(Date.now() + LINK_TTL_MS).toISOString();

  const { error } = await supabase.from('profiles')
    .update({ telegram_link_code: code, telegram_link_code_expires_at: expires_at })
    .eq('id', req.userId);
  if (error) return serverError(res, error);

  res.json({ code, expires_at, deep_link: `https://t.me/${BOT_USERNAME}?start=${code}` });
});

// GET /telegram/status
router.get('/status', auth, async (req, res) => {
  const { data, error } = await supabase.from('profiles')
    .select('telegram_chat_id').eq('id', req.userId).single();
  if (error) return serverError(res, error);
  res.json({ linked: data?.telegram_chat_id != null });
});

// DELETE /telegram/link — отвязать
router.delete('/link', auth, async (req, res) => {
  const { error } = await supabase.from('profiles')
    .update({ telegram_chat_id: null, telegram_link_code: null, telegram_link_code_expires_at: null })
    .eq('id', req.userId);
  if (error) return serverError(res, error);
  res.json({ success: true });
});

// POST /telegram/webhook — принимает апдейты от Telegram (не long-polling).
// Публичный эндпоинт: подлинность запроса проверяется секретным токеном,
// который Telegram кладёт в заголовок при вызове setWebhook с secret_token
// (см. utils/registerTelegramWebhook.js) — без него любой мог бы слать сюда
// фейковые "/start <код>" и угонять чужие привязки.
router.post('/webhook', async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    return res.status(401).end();
  }

  // Telegram ждёт 200 быстро и не заботится о теле ответа — обрабатываем
  // асинхронно, но всё равно отвечаем сразу, чтобы не словить ретраи.
  res.status(200).end();

  const msg = req.body?.message;
  const text = msg?.text?.trim();
  const chatId = msg?.chat?.id;
  if (!text?.startsWith('/start') || !chatId) return;

  const code = text.slice('/start'.length).trim();
  if (!code) {
    return void sendUserTelegram(chatId, 'Откройте эту ссылку через кнопку «Подключить Telegram» на сайте — код одноразовый и не вводится вручную.');
  }

  const { data: prof } = await supabase.from('profiles')
    .select('id, nickname, telegram_link_code_expires_at')
    .eq('telegram_link_code', code)
    .maybeSingle();

  if (!prof || new Date(prof.telegram_link_code_expires_at) < new Date()) {
    return void sendUserTelegram(chatId, 'Ссылка недействительна или устарела — сгенерируйте новую на сайте.');
  }

  const { error } = await supabase.from('profiles')
    .update({ telegram_chat_id: chatId, telegram_link_code: null, telegram_link_code_expires_at: null })
    .eq('id', prof.id);

  if (error) {
    // Скорее всего гонка за уникальный telegram_chat_id (этот чат уже
    // привязан к другому аккаунту) — уникальный индекс из миграции.
    return void sendUserTelegram(chatId, 'Этот Telegram уже подключён к другому аккаунту.');
  }

  sendUserTelegram(chatId, `Готово! Уведомления с аккаунта «${prof.nickname ?? ''}» теперь дублируются сюда.`);
});

module.exports = router;
