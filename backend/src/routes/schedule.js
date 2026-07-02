const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const DEFAULT_STUDY_ID = 62;
const NOT_READY = { error: 'Данные ещё не загружены. Попробуйте через несколько минут.' };

// Render is geo-blocked from lk.gubkin.ru, so these GET routes only ever read
// what the GitHub Actions cache job (running from a non-blocked IP) writes
// directly into schedule_cache via the Supabase REST API — no proxying
// through this backend at all (see ebu.gubkin/scripts/fetch-schedule.js).
async function readCache(key) {
  const { data } = await supabase
    .from('schedule_cache')
    .select('data')
    .eq('cache_key', key)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (data) {
    supabase.from('schedule_cache').update({ last_accessed: new Date().toISOString() }).eq('cache_key', key).then(() => {});
  }
  return data?.data ?? null;
}

// GET /schedule/faculties
router.get('/faculties', async (req, res) => {
  try {
    const data = await readCache('faculties');
    if (!data) return res.status(503).json(NOT_READY);
    res.json(data);
  } catch (err) {
    serverError(res, err, 'schedule/faculties');
  }
});

// GET /schedule/groups?facultyId=X
router.get('/groups', async (req, res) => {
  const { facultyId } = req.query;
  if (!facultyId) return res.status(400).json({ error: 'Укажите facultyId' });
  try {
    const data = await readCache(`groups_${facultyId}`);
    if (!data) return res.status(503).json(NOT_READY);
    res.json(data);
  } catch (err) {
    serverError(res, err, 'schedule/groups');
  }
});

// GET /schedule/lessons?groupId=X&date=DD-M-YYYY
router.get('/lessons', async (req, res) => {
  const { groupId, date } = req.query;
  if (!groupId || !date) return res.status(400).json({ error: 'Укажите groupId и date' });
  try {
    const data = await readCache(`schedule_${groupId}_${date}`);
    if (!data) return res.status(503).json(NOT_READY);
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
