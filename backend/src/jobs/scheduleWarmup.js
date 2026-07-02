const supabase = require('../supabase_client');

const GUBKIN_API = 'https://lk.gubkin.ru/schedule/api/api.php';
const DEFAULT_STUDY_ID = 62;
const MOSCOW_FACULTY_IDS = [5, 0, 8, 3, 21, 12, 19, 2, 1, 13, 4, 6, 7, -5];

const GUBKIN_HEADERS = {
  'Referer': 'https://lk.gubkin.ru/schedule/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

let shouldCancel = false;

async function getFreshCaptcha() {
  try {
    // Шаг 1: заходим на главную страницу — получаем первичную куку сессии
    console.log('[Warmup] Step 1: getting session from main page');

    const pageRes = await fetch('https://lk.gubkin.ru/schedule/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });

    const pageCookies = pageRes.headers.get('set-cookie');
    const pageMatch = pageCookies?.match(/PHPSESSID=([^;]+)/);
    if (!pageMatch) throw new Error('No PHPSESSID from main page request');
    const cookie = pageMatch[1];
    console.log('[Warmup] Got session cookie:', cookie);

    // Шаг 2: запрашиваем картинку капчи с этой же кукой
    console.log('[Warmup] Step 2: fetching captcha image');

    const captchaUrl = `${GUBKIN_API}?act=Captcha&method=generateCaptcha`;
    const captchaRes = await fetch(captchaUrl, {
      headers: {
        'Referer': 'https://lk.gubkin.ru/schedule/',
        'Host': 'lk.gubkin.ru',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': `PHPSESSID=${cookie}`,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!captchaRes.ok) throw new Error(`Captcha request failed: HTTP ${captchaRes.status}`);

    const buffer = await captchaRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    console.log('[Warmup] Captcha image received, size:', buffer.byteLength);

    return { cookie, imageBase64: `data:image/jpeg;base64,${base64}` };
  } catch (e) {
    console.error('[Warmup] Fetch error details:', { message: e.message, cause: e.cause, code: e.cause?.code });
    throw e;
  }
}

async function validateCaptcha(cookie, answer) {
  const res = await fetch(`${GUBKIN_API}?act=Captcha&method=validateCaptcha`, {
    method: 'POST',
    headers: { ...GUBKIN_HEADERS, 'Content-Type': 'application/json', 'Cookie': `PHPSESSID=${cookie}` },
    body: JSON.stringify({ key: answer }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return data.state === true;
}

async function gubkinFetch(cookie, params) {
  const url = new URL(GUBKIN_API);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  console.log('[Warmup] Fetching:', url.toString());
  try {
    const res = await fetch(url.toString(), {
      headers: { ...GUBKIN_HEADERS, 'Host': 'lk.gubkin.ru', 'Accept': 'application/json, text/plain, */*', 'Cookie': `PHPSESSID=${cookie}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = JSON.parse(await res.text());
    console.log('[Warmup] Fetched:', url.toString());
    if (!data.state) {
      const err = new Error(data.reason || 'Gubkin API error');
      if (data.reason?.includes('капч')) err.isCaptcha = true;
      throw err;
    }
    return data;
  } catch (e) {
    console.error('[Warmup] Fetch error details:', { message: e.message, cause: e.cause, code: e.cause?.code });
    throw e;
  }
}

async function updateState(patch) {
  await supabase.from('schedule_warmup_state').update(patch).eq('id', 1);
}

async function getState() {
  const { data } = await supabase.from('schedule_warmup_state').select('*').eq('id', 1).single();
  return data;
}

async function saveToCache(key, data, ttlHours) {
  await supabase.from('schedule_cache').upsert({
    cache_key: key,
    data,
    expires_at: new Date(Date.now() + ttlHours * 3600000).toISOString(),
    last_accessed: new Date().toISOString(),
  }, { onConflict: 'cache_key' });
}

function getThreeWeekDates() {
  const dates = [];
  const now = new Date();
  const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  for (let w = 0; w < 3; w++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + w * 7);
    dates.push(`${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`);
  }
  return dates;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startWarmup() {
  shouldCancel = false;
  await updateState({ status: 'running', progress_current: 0, progress_total: 0, last_error: null });
  try {
    const { cookie, imageBase64 } = await getFreshCaptcha();
    await updateState({ status: 'waiting_captcha', session_cookie: cookie, captcha_image_base64: imageBase64 });
  } catch (e) {
    console.error('[Warmup ERROR]', { message: e.message, stack: e.stack, name: e.name, cause: e.cause });
    await updateState({ status: 'error', last_error: e.message });
  }
}

async function submitCaptchaAndContinue(answer) {
  const state = await getState();
  if (state.status !== 'waiting_captcha') throw new Error('Not waiting for captcha');

  const valid = await validateCaptcha(state.session_cookie, answer);
  if (!valid) {
    const fresh = await getFreshCaptcha();
    await updateState({ session_cookie: fresh.cookie, captcha_image_base64: fresh.imageBase64 });
    return { success: false };
  }

  await updateState({ status: 'running', session_cookie_verified_at: new Date().toISOString(), captcha_image_base64: null });
  runFullWarmup(state.session_cookie); // не ждём завершения
  return { success: true };
}

async function runFullWarmup(cookie) {
  try {
    const facData = await gubkinFetch(cookie, { act: 'list', method: 'getFaculties' });
    await saveToCache('faculties', facData.rows, 30);
    await updateState({ progress_step: 'faculties done' });

    const allGroups = [];
    for (const facultyId of MOSCOW_FACULTY_IDS) {
      if (shouldCancel) { await updateState({ status: 'idle' }); return; }
      try {
        const grpData = await gubkinFetch(cookie, { act: 'list', method: 'getFacultyGroups', facultyId });
        const groups = grpData.rows || [];
        await saveToCache(`groups_${facultyId}`, groups, 30);
        allGroups.push(...groups.map(g => g.id));
        await updateState({ progress_step: `groups_${facultyId} done`, progress_current: allGroups.length });
        await sleep(400);
      } catch (e) {
        console.error(`[Warmup] Faculty ${facultyId}:`, e.message);
      }
    }

    const dates = getThreeWeekDates();
    const totalSteps = allGroups.length * dates.length;
    let done = 0, success = 0, errors = 0;

    for (const groupId of allGroups) {
      if (shouldCancel) { await updateState({ status: 'idle' }); return; }
      for (const date of dates) {
        try {
          const schedData = await gubkinFetch(cookie, { act: 'schedule', date, groupId, studyId: DEFAULT_STUDY_ID });
          const orgs = schedData.rows?.organizations || [];
          const moscow = orgs.find(o => o.id === 0) || orgs[0];
          await saveToCache(`schedule_${groupId}_${date}`, {
            week: schedData.rows?.week?.weekRussia,
            timeChunks: moscow?.lessonsTimeChunks || [],
            lessons: moscow?.lessons || [],
          }, 30);
          success++;
        } catch (e) {
          errors++;
          if (e.isCaptcha) {
            const fresh = await getFreshCaptcha();
            await updateState({
              status: 'waiting_captcha',
              session_cookie: fresh.cookie,
              captcha_image_base64: fresh.imageBase64,
              progress_step: `schedule_${groupId}_${date}`,
              last_error: 'Session expired mid-warmup, need new captcha',
            });
            return;
          }
        }
        done++;
        await updateState({ progress_current: done, progress_total: totalSteps });
        await sleep(300);
      }
    }

    await updateState({ status: 'done', last_run_at: new Date().toISOString() });
    console.log(`[Warmup] Done! Success: ${success}, Errors: ${errors}`);
  } catch (e) {
    console.error('[Warmup ERROR]', { message: e.message, stack: e.stack, name: e.name, cause: e.cause });
    await updateState({ status: 'error', last_error: e.message });
  }
}

function cancelWarmup() { shouldCancel = true; }

module.exports = { startWarmup, submitCaptchaAndContinue, cancelWarmup, getState };
