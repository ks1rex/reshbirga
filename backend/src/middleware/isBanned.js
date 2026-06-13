const supabase = require('../supabase_client');

// Must run after auth middleware (req.userId must be set)
module.exports = async function isBanned(req, res, next) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_banned')
    .eq('id', req.userId)
    .single();

  if (profile?.is_banned) {
    return res.status(403).json({ error: 'Ваш аккаунт заблокирован. Обратитесь в поддержку.' });
  }
  next();
};
