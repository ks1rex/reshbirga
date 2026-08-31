const supabase = require('../supabase_client');

const MEDIA_PREFIX = `${process.env.SUPABASE_URL ?? ''}/storage/v1/object/public/listing-media/`;

function urlToPath(url) {
  return typeof url === 'string' && url.startsWith(MEDIA_PREFIX) ? url.slice(MEDIA_PREFIX.length) : null;
}

// listing-media is shared by services (cover+attachments) and the forum
// (thread cover, post attachments) — a url must be gone from ALL of these
// before it's safe to delete the underlying object.
async function isUrlStillUsed(url) {
  const [{ count: c1 }, { count: c2 }, { count: c3 }, { count: c4 }] = await Promise.all([
    supabase.from('listings').select('id', { count: 'exact', head: true }).eq('cover_url', url),
    supabase.from('listings').select('id', { count: 'exact', head: true }).contains('attachments', [{ url }]),
    supabase.from('forum_threads').select('id', { count: 'exact', head: true }).eq('cover_url', url),
    supabase.from('forum_posts').select('id', { count: 'exact', head: true }).contains('attachments', [{ url }]),
  ]);
  return (c1 + c2 + c3 + c4) > 0;
}

// Call with the URLs that were just replaced/removed (old cover, dropped
// attachments, or everything a deleted listing/post/thread pointed at).
// Deletes each object from storage only if no other row still uses it.
async function deleteUrlsIfUnused(urls) {
  const paths = [];
  for (const url of new Set((urls ?? []).filter(Boolean))) {
    const path = urlToPath(url);
    if (!path) continue;
    if (!(await isUrlStillUsed(url))) paths.push(path);
  }
  if (paths.length) await supabase.storage.from('listing-media').remove(paths);
}

const SWEEP_GRACE_HOURS = 6; // skip objects newer than this — still-open upload/draft

// Catches orphans deleteUrlsIfUnused can't: a file uploaded straight to
// Storage (avatar-style flow) whose listing/post was never saved at all, so
// no delete/edit ever fires. Walks every object in listing-media (paths are
// always `${uid}/...` or `${uid}/forum/...`, per ebu.gubkin's upload code)
// and removes anything unreferenced and older than the grace period.
async function sweepOrphanedMedia() {
  const bucket = supabase.storage.from('listing-media');
  const cutoff = Date.now() - SWEEP_GRACE_HOURS * 3600 * 1000;
  const { data: users } = await bucket.list('', { limit: 1000 });
  const toDelete = [];

  for (const u of users ?? []) {
    if (u.id) continue; // a file directly at bucket root, not a user folder — ignore
    for (const prefix of [u.name, `${u.name}/forum`]) {
      const { data: entries } = await bucket.list(prefix, { limit: 1000 });
      for (const e of entries ?? []) {
        if (!e.id) continue; // subfolder (e.g. "forum"), not a file
        if (new Date(e.created_at).getTime() > cutoff) continue;
        const objectPath = `${prefix}/${e.name}`;
        const url = `${MEDIA_PREFIX}${objectPath}`;
        if (!(await isUrlStillUsed(url))) toDelete.push(objectPath);
      }
    }
  }
  if (toDelete.length) await bucket.remove(toDelete);
  return toDelete.length;
}

function startOrphanMediaSweepJob() {
  const run = () => sweepOrphanedMedia().catch(e => console.error('[mediaCleanup] sweep', e.message));
  run();
  setInterval(run, 24 * 60 * 60 * 1000);
}

module.exports = { deleteUrlsIfUnused, sweepOrphanedMedia, startOrphanMediaSweepJob };
