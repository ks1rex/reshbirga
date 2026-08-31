const { Router } = require('express');
const crypto = require('crypto');
const supabase = require('../supabase_client');
const cashera = require('../utils/cashera');

const router = Router();

// Standard constant-time compare pattern (Node crypto docs): mismatched
// lengths are rejected without calling timingSafeEqual (which throws on
// unequal-length buffers), so this never gets to compare-then-branch on
// content, only on length — length isn't the secret being protected here.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const FINAL_STATUSES = new Set(['paid', 'failed', 'expired', 'refunded', 'chargeback']);

// POST /webhooks/cashera — no auth middleware (external caller); the
// X-Api-Key/X-Secret pair IS the auth. Always resolves 2xx after auth passes,
// per spec, so Cashera doesn't retry-storm us over our own downstream bugs.
router.post('/cashera', async (req, res) => {
  // Guards against the case where CASHERA_API_KEY/SECRET are unset: an
  // empty expected value would otherwise compare equal to a missing header.
  if (!process.env.CASHERA_API_KEY || !process.env.CASHERA_API_SECRET)
    return res.status(401).json({ error: 'unauthorized' });
  const keyOk = safeEqual(req.headers['x-api-key'], process.env.CASHERA_API_KEY);
  const secretOk = safeEqual(req.headers['x-secret'], process.env.CASHERA_API_SECRET);
  if (!keyOk || !secretOk) return res.status(401).json({ error: 'unauthorized' });

  const tx = req.body?.transaction;
  const knownStatus = tx?.status === 'pending' || FINAL_STATUSES.has(tx?.status);
  if (!tx?.external_id || !knownStatus) {
    // Unrecognised shape/status — ack so it isn't retried forever, nothing to process.
    return res.status(200).json({ ok: true });
  }

  const { data, error } = await cashera.applyTransaction(supabase, tx);

  if (error) {
    console.error('[cashera][webhook]', error);
    // Still 200: our own failure shouldn't make Cashera hammer retries: a
    // real crediting bug needs the reconciliation endpoint, not a webhook storm.
    return res.status(200).json({ ok: true });
  }

  if (data.out_mismatch) {
    console.error('[cashera][webhook] amount/currency mismatch', { external_id: tx.external_id, uuid: tx.uuid });
  }

  res.status(200).json({ ok: true });
});

module.exports = router;

// node backend/src/routes/cashera.js — self-check for the auth compare only.
if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(safeEqual('sk_abc', 'sk_abc'), true, 'equal strings must match');
  assert.strictEqual(safeEqual('sk_abc', 'sk_abd'), false, 'differing strings must not match');
  assert.strictEqual(safeEqual('sk_abc', 'sk_abcd'), false, 'different lengths must not match');
  assert.strictEqual(safeEqual(undefined, 'sk_abc'), false, 'missing header must not match');
  // safeEqual alone treats two absent values as equal (both empty buffers) —
  // that's why the route checks process.env.CASHERA_API_KEY/SECRET are
  // non-empty BEFORE calling safeEqual, not relying on this function for it.
  assert.strictEqual(safeEqual(undefined, undefined), true, 'documents the empty-vs-empty edge case guarded above, not a bypass by itself');
  console.log('cashera safeEqual: ok');
}
