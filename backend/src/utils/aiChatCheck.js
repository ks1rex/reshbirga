// ponytail: AI chat moderation disabled by product decision — exchanging
// contact info isn't actually against platform rules (same call already made
// for the regex check in routes/conversations.js), so flagging masked
// contact-sharing attempts had no real action behind it. Full DeepSeek
// implementation (prompt, per-message checks, Telegram digest) is in git
// history if this policy changes and it needs reviving.
async function runAIChatCheck(_orderId) {}

module.exports = { runAIChatCheck };
