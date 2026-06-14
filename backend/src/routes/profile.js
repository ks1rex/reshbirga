const { Router } = require('express');
const auth    = require('../middleware/auth');
const isBanned = require('../middleware/isBanned');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');

const router = Router();
router.use(auth);

// Fields a user is allowed to update via this endpoint.
// Sensitive fields (balance, is_admin, token_balance, has_access, is_banned, etc.)
// are deliberately excluded — only the backend service_role can change those.
const EDITABLE_FIELDS = [
  'full_name',
  'phone',
  'telegram_username',
  'university_group',
  'avatar_url',
  'nickname',
];

// GET /profile — own full profile
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      id, email, nickname, full_name, avatar_url,
      phone, telegram_username, university_group,
      balance, token_balance, is_admin, has_access,
      referral_code, referral_earnings,
      referral_registered_count, referral_qualifying_deposits_count,
      rating_as_customer, rating_as_executor,
      reviews_count_customer, reviews_count_executor,
      is_banned, created_at, updated_at
    `)
    .eq('id', req.userId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Профиль не найден' });
  res.json(data);
});

// PUT /profile — update own editable fields
router.put('/', isBanned, async (req, res) => {
  const patch = {};

  for (const key of EDITABLE_FIELDS) {
    if (!(key in req.body)) continue;
    const val = req.body[key];
    // Coerce empty string to null so the DB stores NULL, not an empty string
    patch[key] = (typeof val === 'string' && val.trim() === '') ? null : val;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Нет допустимых полей для обновления' });
  }

  // Basic validation
  if (patch.phone !== undefined && patch.phone !== null) {
    const digits = String(patch.phone).replace(/\D/g, '');
    if (digits.length !== 11 || (!digits.startsWith('7') && !digits.startsWith('8'))) {
      return res.status(400).json({ error: 'Некорректный формат телефона' });
    }
  }

  if (patch.telegram_username !== undefined && patch.telegram_username !== null) {
    if (!String(patch.telegram_username).startsWith('@')) {
      return res.status(400).json({ error: 'Telegram username должен начинаться с @' });
    }
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', req.userId)
    .select(`
      id, email, nickname, full_name, avatar_url,
      phone, telegram_username, university_group,
      balance, token_balance, is_admin, has_access,
      referral_code, referral_earnings,
      rating_as_customer, rating_as_executor,
      updated_at
    `)
    .single();

  if (error) return serverError(res, error, 'profile:update');
  res.json(data);
});

module.exports = router;
