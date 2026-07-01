const supabase = require('../supabase_client');

// Active-listing limit: base (non-VIP) vs VIP, read from admin_settings so
// the numbers stay a config knob, not a hardcoded constant.
async function getLimitSettings() {
  const { data } = await supabase
    .from('admin_settings')
    .select('key, value')
    .in('key', ['listing_limit_base', 'listing_limit_vip']);
  const map = Object.fromEntries((data ?? []).map(r => [r.key, r.value]));
  return {
    base: parseInt(map.listing_limit_base ?? '2', 10),
    vip: parseInt(map.listing_limit_vip ?? '10', 10),
  };
}

// Counts a user's active *visible* orders (status=open, is_hidden=false) +
// active listings (is_active=true), and returns { used, limit } — limit
// depends on whether the user currently holds VIP (vip_expires_at > now()).
async function getListingUsage(userId) {
  const [{ data: profile }, { count: orderCount }, { count: listingCount }, limits] = await Promise.all([
    supabase.from('profiles').select('vip_expires_at').eq('id', userId).single(),
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('customer_id', userId).eq('status', 'open').eq('is_hidden', false),
    supabase.from('listings').select('id', { count: 'exact', head: true })
      .eq('owner_id', userId).eq('is_active', true),
    getLimitSettings(),
  ]);

  const isVip = !!profile?.vip_expires_at && new Date(profile.vip_expires_at) > new Date();
  const limit = isVip ? limits.vip : limits.base;
  const used = (orderCount ?? 0) + (listingCount ?? 0);
  return { used, limit, isVip };
}

module.exports = { getListingUsage };
