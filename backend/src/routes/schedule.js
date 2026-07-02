const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const GUBKIN_API = 'https://lk.gubkin.ru/schedule/api/api.php';
const DEFAULT_STUDY_ID = 62;

async function getCached(key, ttlHours, fetchFn) {
  const { data: cached } = await supabase
    .from('schedule_cache')
    .select('data, expires_at')
    .eq('cache_key', key)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    await supabase.from('schedule_cache')
      .update({ last_accessed: new Date().toISOString() })
      .eq('cache_key', key);
    return cached.data;
  }

  const freshData = await fetchFn();
  await supabase.from('schedule_cache').upsert({
    cache_key: key,
    data: freshData,
    expires_at: new Date(Date.now() + ttlHours * 3600000).toISOString(),
    last_accessed: new Date().toISOString(),
  }, { onConflict: 'cache_key' });

  return freshData;
}

async function gubkinFetch(params) {
  const url = `${GUBKIN_API}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lk.gubkin.ru ${res.status}`);
  const body = await res.json();
  return body.rows;
}

// GET /schedule/faculties
router.get('/faculties', async (req, res) => {
  try {
    const rows = await getCached('faculties', 24, () =>
      gubkinFetch({ act: 'list', method: 'getFaculties' }));
    res.json(rows);
  } catch (err) {
    serverError(res, err, 'schedule/faculties');
  }
});

// GET /schedule/groups?facultyId=X
router.get('/groups', async (req, res) => {
  const { facultyId } = req.query;
  if (!facultyId) return res.status(400).json({ error: 'Укажите facultyId' });
  try {
    const rows = await getCached(`groups_${facultyId}`, 24, () =>
      gubkinFetch({ act: 'list', method: 'getFacultyGroups', facultyId }));
    rows.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''));
    res.json(rows);
  } catch (err) {
    serverError(res, err, 'schedule/groups');
  }
});

// GET /schedule/lessons?groupId=X&date=DD-M-YYYY&studyId=Y
router.get('/lessons', async (req, res) => {
  const { groupId, date, studyId = DEFAULT_STUDY_ID } = req.query;
  if (!groupId || !date) return res.status(400).json({ error: 'Укажите groupId и date' });
  try {
    const cacheKey = `schedule_${groupId}_${date}_${studyId}`;
    const data = await getCached(cacheKey, 1, async () => {
      const rows = await gubkinFetch({ act: 'schedule', date, groupId, studyId });
      const moscow = rows.organizations.find(o => o.id === 0);
      return {
        week: rows.week.weekRussia,
        timeChunks: moscow?.lessonsTimeChunks ?? [],
        lessons: moscow?.lessons ?? [],
      };
    });
    res.json(data);
  } catch (err) {
    serverError(res, err, 'schedule/lessons');
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
