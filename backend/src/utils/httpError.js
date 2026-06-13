/**
 * Centralised 500 helper: logs the full error server-side (stack, DB details)
 * and returns a generic message to the client so we never leak schema or
 * internals over the wire.
 */
function serverError(res, err, context) {
  // Full detail stays on the server only.
  console.error(`[500]${context ? ' ' + context : ''}:`, err);
  return res.status(500).json({ error: 'Внутренняя ошибка сервера. Попробуйте позже.' });
}

module.exports = { serverError };
