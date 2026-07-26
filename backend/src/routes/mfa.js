const { Router } = require('express');
const auth = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const supabase = require('../supabase_client');
const { serverError } = require('../utils/httpError');
const { sendTelegram } = require('../utils/telegramNotify');
const { generateCodes, hashCode } = require('../utils/mfaBackupCodes');

/**
 * Резервные коды для админского 2FA.
 *
 * Код НЕ даёт aal2-сессию: её GoTrue выдаёт только за настоящий TOTP. Код —
 * это «снять фактор», после чего админ подключает 2FA заново с новым QR.
 * Ровно поэтому /recover не может висеть за adminMiddleware: тот и требует
 * aal2 у админов с подтверждённым фактором, то есть у всех, кому восстановление
 * вообще нужно. Проверка is_admin на этом маршруте своя.
 */
const router = Router();
router.use(auth);

function verifiedFactors(user) {
  return (user?.factors ?? []).filter(f => f.status === 'verified');
}

// GET /mfa/backup-codes — сколько кодов осталось (сами коды не отдаются никогда)
router.get('/backup-codes', adminMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('admin_mfa_backup_codes')
    .select('used_at, created_at')
    .eq('user_id', req.userId);

  if (error) return serverError(res, error, 'mfa:codes:list');

  const rows = data ?? [];
  res.json({
    total: rows.length,
    unused: rows.filter(r => !r.used_at).length,
    generated_at: rows[0]?.created_at ?? null,
  });
});

// POST /mfa/backup-codes — сгенерировать новый комплект (старый становится недействительным)
router.post('/backup-codes', adminMiddleware, async (req, res) => {
  if (verifiedFactors(req.user).length === 0)
    return res.status(400).json({ error: 'Сначала подключите 2FA — резервные коды без неё бесполезны' });

  const codes = generateCodes();

  // Комплект всегда ровно один: старые коды после перегенерации не действуют.
  const { error: delError } = await supabase
    .from('admin_mfa_backup_codes').delete().eq('user_id', req.userId);
  if (delError) return serverError(res, delError, 'mfa:codes:clear');

  const { error } = await supabase
    .from('admin_mfa_backup_codes')
    .insert(codes.map(c => ({ user_id: req.userId, code_hash: c.hash })));
  if (error) return serverError(res, error, 'mfa:codes:insert');

  // Единственный раз, когда коды видны — дальше в базе только хеши.
  res.json({ codes: codes.map(c => c.code), count: codes.length });
});

// POST /mfa/recover  { code } — снять 2FA по резервному коду.
// Без adminMiddleware намеренно: сессия здесь всегда aal1, см. комментарий выше.
router.post('/recover', async (req, res) => {
  const code = req.body?.code;
  if (!code || String(code).trim().length < 4)
    return res.status(400).json({ error: 'Введите резервный код' });

  const { data: profile } = await supabase
    .from('profiles').select('is_admin, nickname').eq('id', req.userId).single();
  if (!profile?.is_admin)
    return res.status(403).json({ error: 'Admin access required' });

  const factors = verifiedFactors(req.user);
  if (factors.length === 0)
    return res.status(400).json({ error: '2FA не подключена — восстанавливать нечего' });

  const { data: row, error: findError } = await supabase
    .from('admin_mfa_backup_codes')
    .select('id')
    .eq('user_id', req.userId)
    .eq('code_hash', hashCode(code))
    .is('used_at', null)
    .maybeSingle();

  if (findError) return serverError(res, findError, 'mfa:recover:lookup');

  if (!row) {
    sendTelegram(
      `⚠️ Неудачная попытка снять 2FA резервным кодом\n` +
      `Админ: @${profile.nickname ?? req.userId}`
    );
    return res.status(400).json({ error: 'Код неверный или уже использован' });
  }

  // Помечаем код использованным ДО снятия фактора: если снятие упадёт, код
  // сгорит — это неприятно (осталось 9), но безопасно. Обратный порядок в худшем
  // случае оставил бы рабочий код при уже снятой 2FA.
  const { error: useError } = await supabase
    .from('admin_mfa_backup_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id);
  if (useError) return serverError(res, useError, 'mfa:recover:mark-used');

  for (const f of factors) {
    const { error } = await supabase.auth.admin.mfa.deleteFactor({ id: f.id, userId: req.userId });
    if (error) return serverError(res, error, 'mfa:recover:delete-factor');
  }

  // Остальные коды тоже гасим: комплект выдавался под снятый фактор.
  await supabase.from('admin_mfa_backup_codes').delete().eq('user_id', req.userId);

  sendTelegram(
    `🔓 2FA снята резервным кодом\n` +
    `Админ: @${profile.nickname ?? req.userId}\n` +
    `Подключите двухфакторную аутентификацию заново.`
  );

  res.json({ success: true, removed_factors: factors.length, codes_left: 0 });
});

module.exports = router;
