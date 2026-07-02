const supabase = require('../supabase_client');

const GUBKIN_API = 'https://lk.gubkin.ru/schedule/api/api.php';

// Keeps popular `schedule_*` cache entries warm past their 1h TTL so users
// don't eat the upstream latency on every request. Mirrors vipExpiry.js's
// setInterval pattern rather than pulling in node-cron for one hourly job.
async function runScheduleRefreshJob() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
  const { data: rows } = await supabase
    .from('schedule_cache')
    .select('cache_key')
    .like('cache_key', 'schedule_%')
    .gt('last_accessed', sevenDaysAgo);

  for (const { cache_key } of rows ?? []) {
    const [, groupId, date, studyId] = cache_key.split('_');
    try {
      const url = `${GUBKIN_API}?${new URLSearchParams({ act: 'schedule', date, groupId, studyId })}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const { rows: apiRows } = await res.json();
      const moscow = apiRows.organizations.find(o => o.id === 0);
      const data = {
        week: apiRows.week.weekRussia,
        timeChunks: moscow?.lessonsTimeChunks ?? [],
        lessons: moscow?.lessons ?? [],
      };
      await supabase.from('schedule_cache').upsert({
        cache_key,
        data,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }, { onConflict: 'cache_key' });
    } catch (err) {
      console.error('[schedule-refresh-job]', cache_key, err?.message);
    }
  }
}

function startScheduleRefreshJob() {
  setInterval(() => {
    runScheduleRefreshJob().catch(err => console.error('[schedule-refresh-job]', err?.message));
  }, 60 * 60 * 1000);
}

module.exports = { runScheduleRefreshJob, startScheduleRefreshJob };
