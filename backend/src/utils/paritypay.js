// ParityPay payment gateway client (SBP deposits only — no payouts through
// this gateway, see routes/wallet.js). Server-only, keys never reach the
// browser. Base URL from PARITYPAY_BASE_URL (https://api.paritypay.net).
const crypto = require('crypto');

function config() {
  const baseUrl = process.env.PARITYPAY_BASE_URL;
  const shopId = process.env.PARITYPAY_SHOP_ID;
  const apiKey = process.env.PARITYPAY_API_KEY;
  if (!baseUrl || !shopId || !apiKey) throw new Error('PARITYPAY_BASE_URL/SHOP_ID/API_KEY не заданы');
  return { baseUrl, shopId, apiKey };
}

// Per docs: sort JSON body keys alphabetically, concatenate the VALUES (not
// keys) in that order with no separator, HMAC-SHA256 the result. Signing key
// differs by direction — key #1 for requests we send, key #2 (verifySignature
// below) for webhooks ParityPay sends us. Reusing the same `params` object
// for both signing and the actual JSON.stringify body (routes below) avoids
// any drift between what's signed and what's sent — PHP's float-to-string
// quirks on their end matter only if our own serialization is inconsistent
// with itself, and it can't be if it's literally the same object.
function sign(params, key) {
  const sorted = Object.keys(params).sort();
  const concatenated = sorted.map(k => String(params[k])).join('');
  return crypto.createHmac('sha256', key).update(concatenated).digest('hex');
}

function verifyWebhookSignature(params, signatureHeader) {
  const key = process.env.PARITYPAY_CALLBACK_KEY;
  if (!key || !signatureHeader) return false;
  const expected = sign(params, key);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signatureHeader), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function requestWithRetry(path, params, { retries = 3, baseDelayMs = 500 } = {}) {
  const { baseUrl, apiKey } = config();
  const body = JSON.stringify(params);
  const signature = sign(params, apiKey);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let resp;
    try {
      resp = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SIGNATURE': signature },
        body,
        signal: AbortSignal.timeout(15000),
      });
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

class ParityPayApiError extends Error {
  constructor(status, body) {
    super(`ParityPay API error ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function parseOrThrow(resp) {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ParityPayApiError(resp.status, body);
  return body;
}

// amount: RUB (not minor units — ParityPay's "Numeric" amount is plain
// rubles, unlike Cashera's kopecks). service pinned to 'sbp': this gateway
// is only wired up for SBP deposits, per product decision.
async function createInvoice({ amount, orderId, comment, callbackUrl, successUrl, failUrl }) {
  const { shopId } = config();
  const params = {
    shop_id: shopId,
    amount,
    order_id: orderId,
    service: 'sbp',
    ...(comment ? { comment } : {}),
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    ...(successUrl ? { success_url: successUrl } : {}),
    ...(failUrl ? { fail_url: failUrl } : {}),
  };
  const resp = await requestWithRetry('/invoice/create', params);
  return parseOrThrow(resp);
}

async function getInvoiceStatus({ orderId }) {
  const { shopId } = config();
  const resp = await requestWithRetry('/invoice/status', { shop_id: shopId, order_id: orderId });
  return parseOrThrow(resp);
}

module.exports = { createInvoice, getInvoiceStatus, verifyWebhookSignature, ParityPayApiError };
