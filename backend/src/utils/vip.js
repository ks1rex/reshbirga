// Shared VIP-status helper: turns a raw vip_expires_at timestamp into the
// public-facing boolean `is_vip`, without leaking the raw expiry date to
// other users' profile/card views.
function isVip(vipExpiresAt) {
  return !!vipExpiresAt && new Date(vipExpiresAt) > new Date();
}

// Replaces `vip_expires_at` with `is_vip` on a single profile-shaped object
// (e.g. a joined `customer`/`owner`/`author`/`executor` sub-object). No-op if
// the object is null/undefined (common for optional joins).
function withIsVip(profileLike) {
  if (!profileLike) return profileLike;
  const { vip_expires_at, ...rest } = profileLike;
  return { ...rest, is_vip: isVip(vip_expires_at) };
}

// VIP price discount by profiles.level (1-10, see utils/reputation.js):
// +10% per level above 1, with level 10 an explicit exception at 100% (not 90%).
function vipDiscountPct(level) {
  const l = Math.min(10, Math.max(1, parseInt(level, 10) || 1));
  return l >= 10 ? 100 : (l - 1) * 10;
}

// Rounded to kopecks — p_price goes straight into the transactions ledger.
function applyVipDiscount(price, level) {
  return Math.round(price * (100 - vipDiscountPct(level))) / 100;
}

module.exports = { isVip, withIsVip, vipDiscountPct, applyVipDiscount };

// ponytail: smallest possible self-check, run with `node src/utils/vip.js`
if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(vipDiscountPct(1), 0);
  assert.strictEqual(vipDiscountPct(5), 40);
  assert.strictEqual(vipDiscountPct(9), 80);
  assert.strictEqual(vipDiscountPct(10), 100);
  assert.strictEqual(vipDiscountPct(null), 0);
  assert.strictEqual(applyVipDiscount(300, 1), 300);
  assert.strictEqual(applyVipDiscount(300, 5), 180);
  assert.strictEqual(applyVipDiscount(1500, 10), 0);
  assert.strictEqual(isVip(null), false);
  console.log('vip.js self-check passed');
}
