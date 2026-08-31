// Cashera payment gateway client. Server-only — CASHERA_API_KEY never reaches
// the browser. Base URL and auth header per docs.cashera.cash.
const BASE_URL = 'https://api.cashera.cash/api/v1';

function apiKey() {
  const key = process.env.CASHERA_API_KEY;
  if (!key) throw new Error('CASHERA_API_KEY не задан');
  return key;
}

// Retries network errors and 5xx with exponential backoff, per spec — safe
// because external_id makes the create-transaction call idempotent on
// Cashera's side (a retried create returns the same checkout, not a dupe).
async function requestWithRetry(path, options, { retries = 3, baseDelayMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let resp;
    try {
      resp = await fetch(`${BASE_URL}${path}`, { ...options, signal: AbortSignal.timeout(15000) });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) { await sleep(baseDelayMs * 2 ** attempt); continue; }
      throw err;
    }
    if (resp.status >= 500 && attempt < retries) {
      await sleep(baseDelayMs * 2 ** attempt);
      continue;
    }
    return resp;
  }
  throw lastErr;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Throws a CasheraApiError with the response status/body attached, so routes
// can branch on err.status (401/403/422/429/502) per spec.
class CasheraApiError extends Error {
  constructor(status, body) {
    super(`Cashera API error ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function parseOrThrow(resp) {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new CasheraApiError(resp.status, body);
  return body;
}

// amountMinor: integer, minor units (RUB * 100). payment_method is
// intentionally NEVER sent (not even null) — per spec, omitting it puts the
// buyer on the "common payform", which only lists whatever's enabled for our
// merchant. Right now that's crypto only (СБП/карта go through a separate,
// not-yet-agreed gateway) — toggled in Cashera's own dashboard, not here.
async function createTransaction({ amountMinor, externalId, description, callbackUrl, successUrl, failUrl }) {
  const resp = await requestWithRetry('/integration/transactions', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountMinor,
      currency: 'RUB',
      external_id: externalId,
      description,
      callback_url: callbackUrl,
      ...(successUrl ? { success_url: successUrl } : {}),
      ...(failUrl ? { fail_url: failUrl } : {}),
    }),
  });
  return parseOrThrow(resp);
}

async function getTransactionByExternalId(externalId) {
  const resp = await requestWithRetry(`/integration/transactions/by-external-id/${encodeURIComponent(externalId)}`, {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey() },
  });
  return parseOrThrow(resp);
}

// Applies one transaction's current state through the idempotent
// process_cashera_webhook RPC — shared by the webhook handler and the manual
// reconciliation endpoint (routes/wallet.js) so both go through exactly the
// same crediting path.
async function applyTransaction(supabase, tx) {
  return supabase.rpc('process_cashera_webhook', {
    p_external_id: tx.external_id,
    p_uuid: tx.uuid ?? null,
    p_new_status: tx.status,
    p_amount: tx.amount,
    p_currency: tx.currency ?? 'RUB',
  }).single();
}

module.exports = { createTransaction, getTransactionByExternalId, applyTransaction, CasheraApiError };
