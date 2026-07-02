const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const DEFAULT_STUDY_ID = 62;
const UNAVAILABLE = { error: 'Сервер университета временно недоступен. Попробуйте через несколько минут.' };

const GUBKIN_API = 'https://lk.gubkin.ru/schedule/api/api.php';
let sessionCookie = null;
let sessionCookieTime = 0;

async function getSessionCookie() {
  // Обновляем куку раз в 30 минут
  if (sessionCookie && Date.now() - sessionCookieTime < 30 * 60 * 1000) {
    return sessionCookie;
  }

  const res = await fetch('https://lk.gubkin.ru/schedule/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    },
  });

  const cookies = res.headers.get('set-cookie');
  const match = cookies?.match(/PHPSESSID=([^;]+)/);
  if (!match) throw new Error('No PHPSESSID from gubkin');

  sessionCookie = match[1];
  sessionCookieTime = Date.now();
  console.log('[Schedule] Got new session cookie');
  return sessionCookie;
}

async function gubkinFetch(params) {
  const cookie = await getSessionCookie();
  const url = new URL(GUBKIN_API);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'Referer': 'https://lk.gubkin.ru/schedule/',
      'Host': 'lk.gubkin.ru',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': `PHPSESSID=${cookie}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${text.slice(0, 100)}`);
  }

  if (!data.state) {
    // Если капча — сбрасываем куку чтобы получить новую
    if (data.reason?.includes('капч')) {
      sessionCookie = null;
      sessionCookieTime = 0;
    }
    throw new Error(data.reason || 'Gubkin API error');
  }
  return data;
}

// Кеш в schedule_cache: свежие данные отдаём сразу, если истекли — пробуем
// обновить, а если апстрим недоступен — отдаём то, что есть, с флагом stale.
async function getCached(key, ttlHours, fetchFn) {
  const { data: fresh } = await supabase
    .from('schedule_cache')
    .select('data')
    .eq('cache_key', key)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (fresh) {
    supabase.from('schedule_cache').update({ last_accessed: new Date().toISOString() }).eq('cache_key', key).then(() => {});
    return { data: fresh.data, stale: false };
  }

  let freshData;
  try {
    freshData = await fetchFn();
  } catch (err) {
    const { data: staleRow } = await supabase
      .from('schedule_cache')
      .select('data')
      .eq('cache_key', key)
      .single();
    if (staleRow) return { data: staleRow.data, stale: true };
    throw err;
  }

  await supabase.from('schedule_cache').upsert({
    cache_key: key,
    data: freshData,
    expires_at: new Date(Date.now() + ttlHours * 3600000).toISOString(),
    last_accessed: new Date().toISOString(),
  }, { onConflict: 'cache_key' });

  return { data: freshData, stale: false };
}

function respondCached(res, { data, stale }) {
  if (stale) return res.json({ data, stale: true });
  res.json(data);
}

// GET /schedule/faculties
router.get('/faculties', async (req, res) => {
  try {
    const result = await getCached('faculties', 24, () =>
      gubkinFetch({ act: 'list', method: 'getFaculties' }).then(r => r.rows));
    respondCached(res, result);
  } catch (err) {
    res.status(503).json(UNAVAILABLE);
  }
});

// GET /schedule/groups?facultyId=X
router.get('/groups', async (req, res) => {
  const { facultyId } = req.query;
  if (!facultyId) return res.status(400).json({ error: 'Укажите facultyId' });
  try {
    const result = await getCached(`groups_${facultyId}`, 24, () =>
      gubkinFetch({ act: 'list', method: 'getFacultyGroups', facultyId }).then(r => r.rows));
    respondCached(res, result);
  } catch (err) {
    res.status(503).json(UNAVAILABLE);
  }
});

// GET /schedule/lessons?groupId=X&date=DD-M-YYYY&studyId=62
router.get('/lessons', async (req, res) => {
  const { groupId, date, studyId = DEFAULT_STUDY_ID } = req.query;
  if (!groupId || !date) return res.status(400).json({ error: 'Укажите groupId и date' });
  try {
    const result = await getCached(`schedule_${groupId}_${date}`, 1, async () => {
      const { rows } = await gubkinFetch({ act: 'schedule', date, groupId, studyId });
      const moscow = rows.organizations?.[0];
      return {
        week: rows.week?.weekRussia,
        timeChunks: moscow?.lessonsTimeChunks ?? [],
        lessons: moscow?.lessons ?? [],
      };
    });
    respondCached(res, result);
  } catch (err) {
    res.status(503).json(UNAVAILABLE);
  }
});

// POST /schedule/save-group  { groupId, facultyId, studyId }
router.post('/save-group', auth, async (req, res) => {
  const { groupId, facultyId, studyId } = req.body;
  if (!groupId || !facultyId) return res.status(400).json({ error: 'Укажите groupId и facultyId' });
  const { error } = await supabase
    .from('profiles')
    .update({
      schedule_group_id: groupId,
      schedule_faculty_id: facultyId,
      schedule_study_id: studyId ?? DEFAULT_STUDY_ID,
    })
    .eq('id', req.userId);
  if (error) return serverError(res, error, 'schedule/save-group');
  res.json({ success: true });
});

// GET /schedule/saved-group
router.get('/saved-group', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('schedule_group_id, schedule_faculty_id, schedule_study_id')
    .eq('id', req.userId)
    .single();
  if (error) return serverError(res, error, 'schedule/saved-group');
  res.json({
    groupId: data.schedule_group_id,
    facultyId: data.schedule_faculty_id,
    studyId: data.schedule_study_id,
  });
});

module.exports = router;
