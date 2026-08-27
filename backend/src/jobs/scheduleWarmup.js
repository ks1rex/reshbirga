const supabase = require('../supabase_client');
const { fetchAll } = require('../utils/pagedFetch');
const { sendTelegram } = require('../utils/telegramNotify');

const GUBKIN_API = 'https://lk.gubkin.ru/schedule/api/api.php';
const DEFAULT_STUDY_ID = 62;
const MOSCOW_FACULTY_IDS = [5, 0, 8, 3, 21, 12, 19, 2, 1, 13, 4, 6, 7, -5];

const GUBKIN_HEADERS = {
  'Referer': 'https://lk.gubkin.ru/schedule/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

let shouldCancel = false;
let forceRefetch = false;

// Teachers seen during the current warmup run, keyed by full name so the
// same person met across many groups/dates is only counted once. Lessons
// only ever come from the Moscow organization (see `moscow.lessons` below),
// so this is already scoped to Moscow — no separate "not Moscow" filter needed.
let seenTeachers = new Map();

function collectTeachers(lessons) {
  for (const lesson of lessons || []) {
    for (const t of lesson.teachers || []) {
      if (!t.lastName) continue;
      const fullName = [t.lastName, t.firstName, t.patronymic].filter(Boolean).join(' ');
      if (!seenTeachers.has(fullName)) seenTeachers.set(fullName, fullName);
    }
  }
}

// Adds any newly-seen teacher to the `teachers` directory. No unique
// constraint on full_name, so dedupe against existing rows here instead.
async function syncTeachers() {
  if (seenTeachers.size === 0) return { added: 0 };
  const { data: existing } = await fetchAll(() => supabase.from('teachers').select('full_name'));
  const existingNames = new Set((existing ?? []).map(r => r.full_name));
  const toInsert = [...seenTeachers.keys()]
    .filter(name => !existingNames.has(name))
    .map(full_name => ({ full_name }));
  if (toInsert.length) {
    const { error } = await supabase.from('teachers').insert(toInsert);
    if (error) { console.error('[Warmup] teacher insert error', error.message); return { added: 0 }; }
  }
  return { added: toInsert.length };
}

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

// Every cache key that's still valid. This is what makes a warmup resumable:
// a run that died (captcha, crash, restart, cancel) already persisted every
// key it managed to fetch, so the next run just skips them instead of
// re-fetching thousands of schedules from the start.
async function loadWarmCacheKeys() {
  const { data } = await fetchAll(() => supabase
    .from('schedule_cache')
    .select('cache_key')
    .gt('expires_at', new Date().toISOString()));
  return new Set((data ?? []).map(r => r.cache_key));
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

// `force: true` re-fetches keys that are still warm in schedule_cache;
// otherwise the run resumes and only fills the gaps.
async function startWarmup({ force = false } = {}) {
  shouldCancel = false;
  forceRefetch = force;
  await updateState({ status: 'running', progress_current: 0, progress_total: 0, last_error: null, progress_step: null });
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

// Manual escape hatch for a wedged 'running'/'waiting_captcha' state. The
// in-process cancel flag lives in this module, so a restart mid-run (Render
// redeploy, crash) leaves the DB row saying 'running' with nobody working on
// it, and /start refuses to launch. This clears it; progress in
// schedule_cache is untouched, so the next run resumes where it stopped.
async function resetWarmup() {
  shouldCancel = true;
  await updateState({
    status: 'idle',
    captcha_image_base64: null,
    session_cookie: null,
    progress_step: null,
    last_error: null,
  });
}

async function runFullWarmup(cookie) {
  try {
    const warm = forceRefetch ? new Set() : await loadWarmCacheKeys();
    seenTeachers = new Map();
    let skipped = 0;

    if (forceRefetch || !warm.has('faculties')) {
      const facData = await gubkinFetch(cookie, { act: 'list', method: 'getFaculties' });
      await saveToCache('faculties', facData.rows, 30);
    } else skipped++;
    await updateState({ progress_step: 'faculties done' });

    const allGroups = [];
    for (const facultyId of MOSCOW_FACULTY_IDS) {
      if (shouldCancel) { await updateState({ status: 'idle' }); return; }
      const key = `groups_${facultyId}`;
      try {
        if (!forceRefetch && warm.has(key)) {
          // Already warm — but we still need the group ids for the schedule
          // pass below, so read them back out of the cache instead of the API.
          const { data: row } = await supabase.from('schedule_cache').select('data').eq('cache_key', key).maybeSingle();
          allGroups.push(...((row?.data ?? []).map(g => g.id)));
          skipped++;
        } else {
          const grpData = await gubkinFetch(cookie, { act: 'list', method: 'getFacultyGroups', facultyId });
          const groups = grpData.rows || [];
          await saveToCache(key, groups, 30);
          allGroups.push(...groups.map(g => g.id));
          await sleep(400);
        }
        await updateState({ progress_step: `${key} done`, progress_current: allGroups.length });
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
        const key = `schedule_${groupId}_${date}`;
        if (!forceRefetch && warm.has(key)) {
          skipped++;
          done++;
          await updateState({ progress_current: done, progress_total: totalSteps });
          continue; // no API call, no sleep — resumed keys cost nothing
        }
        try {
          const schedData = await gubkinFetch(cookie, { act: 'schedule', date, groupId, studyId: DEFAULT_STUDY_ID });
          const orgs = schedData.rows?.organizations || [];
          const moscow = orgs.find(o => o.id === 0) || orgs[0];
          await saveToCache(key, {
            week: schedData.rows?.week?.weekRussia,
            timeChunks: moscow?.lessonsTimeChunks || [],
            lessons: moscow?.lessons || [],
          }, 30);
          collectTeachers(moscow?.lessons);
          success++;
        } catch (e) {
          errors++;
          if (e.isCaptcha) {
            const fresh = await getFreshCaptcha();
            await updateState({
              status: 'waiting_captcha',
              session_cookie: fresh.cookie,
              captcha_image_base64: fresh.imageBase64,
              progress_step: key,
              last_error: 'Session expired mid-warmup, need new captcha',
            });
            sendTelegram(`🔐 Прогрев расписания: сессия истекла, нужна новая капча (${done}/${totalSteps})`);
            return;
          }
        }
        done++;
        await updateState({ progress_current: done, progress_total: totalSteps });
        await sleep(300);
      }
    }

    const { added: teachersAdded } = await syncTeachers();

    await updateState({ status: 'done', last_run_at: new Date().toISOString(), progress_step: `готово: ${success} новых, ${skipped} из кэша, ${errors} ошибок, ${teachersAdded} новых преподавателей` });
    console.log(`[Warmup] Done! Success: ${success}, Skipped(cached): ${skipped}, Errors: ${errors}, Teachers added: ${teachersAdded}`);
  } catch (e) {
    console.error('[Warmup ERROR]', { message: e.message, stack: e.stack, name: e.name, cause: e.cause });
    await updateState({ status: 'error', last_error: e.message });
  }
}

function cancelWarmup() { shouldCancel = true; }

// ── Automatic scheduling ──────────────────────────────────────
//
// A warmup can't run fully unattended — step one is a captcha only a human can
// solve. So the schedule auto-*starts* the run and pings Telegram that a
// captcha is waiting; everything after that is unattended.
//
// Interval (hours) comes from admin_settings.warmup_auto_hours; 0/unset = off.
const SCHEDULE_TICK_MS = 15 * 60 * 1000;
let lastSeenProgress = null; // for stale-'running' detection, see below

async function warmupScheduleTick() {
  const { data: row } = await supabase
    .from('admin_settings').select('value').eq('key', 'warmup_auto_hours').maybeSingle();
  const hours = parseFloat(row?.value);
  if (!Number.isFinite(hours) || hours <= 0) return;

  const state = await getState();
  if (!state) return;

  // Stale 'running': progress hasn't moved for two consecutive ticks (30 min).
  // Covers the restart case too — after a redeploy nothing is driving the run,
  // so progress_current can never change again.
  if (state.status === 'running') {
    const key = `${state.progress_current}/${state.progress_total}`;
    if (lastSeenProgress === key) {
      lastSeenProgress = null;
      await updateState({ status: 'error', last_error: 'Прогрев зависал в статусе «выполняется» и был сброшен автоматически' });
      sendTelegram('⚠️ Прогрев расписания зависал в статусе «выполняется» — сброшен автоматически');
      return;
    }
    lastSeenProgress = key;
    return;
  }
  lastSeenProgress = null;

  if (state.status === 'waiting_captcha') return; // already waiting on a human
  if (!['idle', 'done', 'error'].includes(state.status)) return;

  const lastRun = state.last_run_at ? new Date(state.last_run_at).getTime() : 0;
  if (Date.now() - lastRun < hours * 3600000) return;

  await startWarmup();
  sendTelegram('🔐 Автопрогрев расписания запущен — нужно ввести капчу в админке (Прогрев расписания)');
}

function startWarmupScheduleJob() {
  setInterval(() => {
    warmupScheduleTick().catch(err => console.error('[warmup-schedule]', err?.message));
  }, SCHEDULE_TICK_MS);
}

module.exports = { startWarmup, submitCaptchaAndContinue, cancelWarmup, resetWarmup, getState, startWarmupScheduleJob };
