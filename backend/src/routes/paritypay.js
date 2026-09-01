const { Router } = require('express');
const supabase = require('../supabase_client');
const paritypay = require('../utils/paritypay');

const router = Router();

const KNOWN_STATUSES = new Set(['NEW', 'PAID', 'EXPIRED', 'ERROR', 'REFUNDED']);

// POST /webhooks/paritypay — no auth middleware (external caller); the
// X-SIGNATURE header (HMAC-SHA256 of the sorted body values with callback
// key #2) is the auth. Always 2xx once the signature checks out, per
// ParityPay's docs, so it doesn't retry-storm us over our own bugs — they
// already retry up to 5 times on a non-200, no need to add more via errors.
router.post('/paritypay', async (req, res) => {
  if (!paritypay.verifyWebhookSignature(req.body, req.headers['x-signature']))
    return res.status(401).json({ error: 'unauthorized' });

  const body = req.body ?? {};
  if (!body.order_id || !KNOWN_STATUSES.has(body.status)) {
    // Unrecognised shape/status — ack so it isn't retried forever, nothing to process.
    return res.status(200).json({ ok: true });
  }

  const { data, error } = await supabase.rpc('process_paritypay_webhook', {
    p_external_id: body.order_id,
    p_invoice_id: body.id ?? null,
    p_new_status: body.status,
    p_amount: body.amount,
    p_parity_credited: body.credited ?? null,
  }).single();

  if (error) {
    console.error('[paritypay][webhook]', error);
    return res.status(200).json({ ok: true });
  }

  if (data.out_mismatch) {
    console.error('[paritypay][webhook] amount mismatch', { order_id: body.order_id, invoice_id: body.id });
  }

  res.status(200).json({ ok: true });
});

module.exports = router;
