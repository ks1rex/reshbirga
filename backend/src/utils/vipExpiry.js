const supabase = require('../supabase_client');

// Lazy VIP-expiry enforcement (no cron dependency): runs hourly, finds users
// whose VIP lapsed and who are now over the base limit, and hides their
// newest excess open orders / active listings (owner can re-toggle later,
// within the base limit) — mirrors startForumAIJob()'s fire-and-forget pattern.
async function runVipExpiryJob() {
  const baseLimit = await baseListingLimit();

  const { data: expired } = await supabase
    .from('profiles')
    .select('id')
    .not('vip_expires_at', 'is', null)
    .lt('vip_expires_at', new Date().toISOString());
  if (!expired?.length) return;

  for (const { id: userId } of expired) {
    await hideExcessForUser(userId, baseLimit);
  }
}

// Один пользователь: скрыть всё, что не влезает в базовый лимит. Вынесено из
// цикла, чтобы отмена VIP администратором (POST /admin/vip/:id/cancel)
// применялась сразу, а не ждала часового прогона, и не дублировала эту логику.
async function hideExcessForUser(userId, baseLimit) {
  const { data: orders } = await supabase
    .from('orders').select('id, created_at')
    .eq('customer_id', userId).eq('status', 'open').eq('is_hidden', false)
    .order('created_at', { ascending: false });
  const { data: listings } = await supabase
    .from('listings').select('id, created_at')
    .eq('owner_id', userId).eq('is_active', true)
    .order('created_at', { ascending: false });

  // Merge both kinds, newest first, and hide the excess over baseLimit.
  const items = [
    ...(orders ?? []).map(o => ({ type: 'order', id: o.id, created_at: o.created_at })),
    ...(listings ?? []).map(l => ({ type: 'listing', id: l.id, created_at: l.created_at })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const excess = items.slice(0, Math.max(0, items.length - baseLimit));
  for (const item of excess) {
    if (item.type === 'order') {
      await supabase.from('orders').update({ is_hidden: true, hidden_reason: 'vip_expired' }).eq('id', item.id);
    } else {
      await supabase.from('listings').update({ is_active: false, hidden_reason: 'vip_expired' }).eq('id', item.id);
    }
  }
  return excess.length;
}

// Базовый лимит объявлений — тот же ключ, что читает джоб.
async function baseListingLimit() {
  const { data } = await supabase
    .from('admin_settings').select('value').eq('key', 'listing_limit_base').single();
  return parseInt(data?.value ?? '2', 10);
}

function startVipExpiryJob() {
  // Run every hour
  setInterval(() => {
    runVipExpiryJob().catch(err => console.error('[vip-expiry-job]', err?.message));
  }, 60 * 60 * 1000);
}

module.exports = { runVipExpiryJob, startVipExpiryJob, hideExcessForUser, baseListingLimit };
