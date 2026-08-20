const supabase = require('../supabase_client');

// Must run after auth middleware (req.userId / req.authAal must be set)
module.exports = async function adminMiddleware(req, res, next) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin, is_owner')
    .eq('id', req.userId)
    .single();

  if (!profile?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Second factor, when the admin has one. Without this check 2FA would be
  // decorative: Supabase issues a working aal1 session on password alone even
  // for accounts with a verified TOTP factor, so the admin API has to insist on
  // aal2 itself. Enforced only for admins who actually enrolled — otherwise
  // turning MFA on would lock out every other admin at once.
  const hasVerifiedFactor = (req.user?.factors ?? []).some(f => f.status === 'verified');
  if (hasVerifiedFactor && req.authAal !== 'aal2') {
    return res.status(403).json({
      error: 'Требуется подтверждение второго фактора (2FA)',
      code: 'MFA_REQUIRED',
    });
  }

  req.profile = profile;
  next();
};

// Second-tier gate: owner-only sections (finance, VIP, GOST templates nav,
// schedule-warmup, platform settings, stats). Must run after adminMiddleware
// (needs req.profile.is_owner).
module.exports.requireOwner = function requireOwner(req, res, next) {
  if (!req.profile?.is_owner) {
    return res.status(403).json({ error: 'Требуются права владельца' });
  }
  next();
};
