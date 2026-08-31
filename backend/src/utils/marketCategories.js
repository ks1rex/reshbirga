const crypto = require('crypto');
const supabase = require('../supabase_client');
const { sendTelegram } = require('./telegramNotify');
const { notifyUser } = require('./notify');

const AI_SYSTEM_PROMPT = `Ты модератор категорий заказов на студенческой бирже услуг (репетиторство,
курсовые, дизайн, программирование и т.п.). Тебе дают название НОВОЙ
категории, которого нет в текущем списке. Оцени его:
- approve — нормальное, по теме учёбы/фриланса название, не дублирует смысл
  уже существующих категорий
- reject — оскорбительное, бессмысленное, реклама/спам, либо явно не по теме
  биржи
- unsure — неочевидный случай, пусть решает человек

Ответь ТОЛЬКО JSON: {"verdict":"approve"} или {"verdict":"reject","reason":"..."} или {"verdict":"unsure"}`;

async function callDeepSeek(name, existingNames, apiKey) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: `Существующие категории: ${existingNames.join(', ')}\n\nНовая категория: «${name}»` },
      ],
      max_tokens: 80,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content ?? '').trim().replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(text);
}

async function createApprovedCategory(name) {
  const { data, error } = await supabase
    .from('market_categories')
    .insert({ id: crypto.randomUUID(), name, icon: null, sort_order: 99 })
    .select('id').single();
  if (error) console.error('createApprovedCategory error:', error.message);
  return data ?? null;
}

// Категория 'Другое' — фоллбэк, куда переставляется заказ/услуга при
// авто-отклонении ИИ (сама категория при этом не пропадает и не блокирует
// заказ — просто ярлык меняется на что-то валидное).
async function fallbackCategoryName() {
  const { data } = await supabase.from('market_categories').select('name').eq('id', 'other').maybeSingle();
  return data?.name ?? null;
}

async function reassignTarget(orderId, listingId, categoryName) {
  if (!categoryName) return;
  if (orderId) await supabase.from('orders').update({ category: categoryName }).eq('id', orderId);
  if (listingId) await supabase.from('listings').update({ category: categoryName }).eq('id', listingId);
}

// Заказ/услуга создаётся с введённой категорией сразу (category — обычный
// text без FK, как было и раньше). Эта функция решает судьбу самой заявки на
// новую категорию — не блокирует и не может провалить создание заказа/услуги
// (ошибки тут только логируются).
//
// Если настроен DEEPSEEK_API_KEY — сперва спрашиваем ИИ: явно адекватное
// название сразу становится настоящей категорией, явно неуместное —
// отклоняется автоматически (заказ/услуга переставляется на 'Другое'),
// неочевидное — идёт на ручную модерацию, как и при отсутствии ключа.
async function maybeRequestNewCategory({ category, orderId, listingId, userId }) {
  const name = category?.trim();
  if (!name) return;

  try {
    const { data: allCategories } = await supabase.from('market_categories').select('id, name');
    const existing = (allCategories ?? []).find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return;

    const apiKey = process.env.DEEPSEEK_API_KEY;
    let aiVerdict = null;
    if (apiKey) {
      try {
        aiVerdict = await callDeepSeek(name, (allCategories ?? []).map(c => c.name), apiKey);
      } catch (e) {
        console.error('marketCategories AI check failed:', e.message);
      }
    }

    if (aiVerdict?.verdict === 'approve') {
      await createApprovedCategory(name);
      await supabase.from('market_category_requests').insert({
        name, target_order_id: orderId ?? null, target_listing_id: listingId ?? null,
        requested_by: userId, status: 'approved', reviewed_at: new Date().toISOString(),
      });
      return;
    }

    if (aiVerdict?.verdict === 'reject') {
      const fallback = await fallbackCategoryName();
      await reassignTarget(orderId, listingId, fallback);
      await supabase.from('market_category_requests').insert({
        name, target_order_id: orderId ?? null, target_listing_id: listingId ?? null,
        requested_by: userId, status: 'rejected',
        reject_reason: aiVerdict.reason ? `ИИ: ${aiVerdict.reason}` : 'Отклонено ИИ',
        reviewed_at: new Date().toISOString(),
      });
      notifyUser(userId, 'category_rejected', 'Новая категория не принята',
        fallback ? `«${name}» не подошла — заказ/услуга переставлены на «${fallback}»` : `«${name}» не подошла`, undefined);
      return;
    }

    // unsure или ИИ недоступен/не настроен — ручная модерация как раньше.
    const { error } = await supabase.from('market_category_requests').insert({
      name, target_order_id: orderId ?? null, target_listing_id: listingId ?? null, requested_by: userId,
    });
    if (error) { console.error('maybeRequestNewCategory insert error:', error.message); return; }
    sendTelegram(`🏷️ Новая категория на модерации: «${name}»`);
  } catch (e) {
    console.error('maybeRequestNewCategory failed:', e.message);
  }
}

module.exports = { maybeRequestNewCategory };
