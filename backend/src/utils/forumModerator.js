const supabase = require('../supabase_client');
const { sendTelegram } = require('./telegramNotify');

// ── Level 1: sync regex filter ────────────────────────────────

const EXTREMISM_RE = [
  /нацист|хайль|зиг[\s\-.]?хайль|свастик|ваффен[\s\-.]?сс\b|третий[\s\-.]?рейх/i,
  /\b(убей|уничтожь|казни)\s+.{0,30}(евреев?|мусульман|русских?|украинцев?|чеченцев?)/i,
  /\b(isis|игил|игиш)\b/i,
  /призы[вб].{0,30}(террор|насили|геноцид)/i,
];

const ADVERTISING_RE = [
  /(куплю|продам)\s+(подписк|аккаунт|доступ)/i,
  /utm_(source|medium|campaign)/i,
  /@\w+\s+(купить|продать|заказать|стоит\s+\d)/i,
  /переходи\s+по\s+ссылке\s+https?:/i,
  /заработ\w+\s+\d+.{0,20}(рублей?|тысяч).{0,20}(день|час|неделю)/i,
];

function checkRegex(content) {
  for (const re of EXTREMISM_RE) {
    if (re.test(content)) return { blocked: true, reason: 'extremism' };
  }
  for (const re of ADVERTISING_RE) {
    if (re.test(content)) return { blocked: true, reason: 'advertising' };
  }
  return { blocked: false };
}

async function checkSpam(content, userId) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('forum_posts')
    .select('content')
    .eq('author_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);
  if (!data?.length) return false;
  const norm = content.trim().toLowerCase();
  return data.filter(p => p.content.trim().toLowerCase() === norm).length >= 3;
}

// Returns { blocked, reason } — call before inserting the post.
async function moderateSync(content, userId) {
  const regexResult = checkRegex(content);
  if (regexResult.blocked) return regexResult;
  const spam = await checkSpam(content, userId);
  if (spam) return { blocked: true, reason: 'spam' };
  return { blocked: false };
}

// ── Level 2: async DeepSeek AI moderation ────────────────────

const AI_SYSTEM_PROMPT = `Ты модератор студенческого форума. Проверь сообщение ТОЛЬКО на:
1. Экстремизм — призывы к насилию, ненависти по признаку расы/нации/религии
2. Явная коммерческая реклама — продвижение сторонних платных сервисов
3. Координированный спам — бессмысленный повторяющийся контент без ценности

НЕ флагируй: мат, критику, жалобы, обмен контактами, эмоции, споры.
Ответь ТОЛЬКО JSON: {"flagged":true,"reason":"краткое описание"} или {"flagged":false}`;

async function callDeepSeek(content, apiKey) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:       'deepseek-chat',
      messages:    [{ role: 'system', content: AI_SYSTEM_PROMPT }, { role: 'user', content }],
      max_tokens:  40,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content ?? '').trim().replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(text);
}

// Guard against overlapping runs: a slow batch (up to 20 posts × 20s timeout)
// could still be in flight when the next interval fires, which would let two
// runs pick the same pending_review rows and double-flag/double-notify.
let aiJobRunning = false;

async function runForumAIJob() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return;
  if (aiJobRunning) return;
  aiJobRunning = true;
  try {
    await runForumAIJobInner(apiKey);
  } finally {
    aiJobRunning = false;
  }
}

async function runForumAIJobInner(apiKey) {
  const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: posts } = await supabase
    .from('forum_posts')
    .select('id, content')
    .eq('moderation_status', 'pending_review')
    .lt('created_at', cutoff)
    .limit(20);

  if (!posts?.length) return;

  for (const post of posts) {
    try {
      const result = await callDeepSeek(post.content, apiKey);
      if (result?.flagged) {
        await supabase.from('forum_posts').update({ moderation_status: 'flagged' }).eq('id', post.id);
        await supabase.from('forum_moderation_log').insert({
          post_id:    post.id,
          action:     'ai_flag',
          ai_flagged: true,
          ai_reason:  result.reason ?? 'AI flagged',
        });
        await sendTelegram(
          `🚨 Форум: AI-модерация\nПричина: ${result.reason ?? '—'}\n\n${post.content.slice(0, 300)}`
        );
      } else {
        await supabase.from('forum_posts').update({ moderation_status: 'approved' }).eq('id', post.id);
      }
    } catch (err) {
      console.error('[forum-ai] post', post.id, err?.message);
    }
  }
}

function startForumAIJob() {
  // Run every 10 minutes
  setInterval(() => {
    runForumAIJob().catch(err => console.error('[forum-ai-job]', err?.message));
  }, 10 * 60 * 1000);
}

module.exports = { moderateSync, startForumAIJob };
