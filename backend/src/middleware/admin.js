const supabase = require('../supabase_client');

// Must run after auth middleware (req.userId must be set)
module.exports = async function adminMiddleware(req, res, next) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', req.userId)
    .single();

  if (!profile?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};
