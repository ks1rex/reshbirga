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

module.exports = { isVip, withIsVip };
