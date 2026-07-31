# API Endpoints

No `/api` prefix — all routers are mounted directly on root in `backend/src/app.js`. Auth is a Supabase JWT verified by `backend/src/middleware/auth.js` (`auth` = required, `optionalAuth` = attaches user if present); `isBanned` blocks banned users; `requireAdmin`/admin routes require `profiles.is_admin = true`.

`GET /health` → `{ "status": "ok" }`.

## `/orders` (`routes/orders.js`)
`GET /` (list, optionalAuth) · `GET /mine` · `GET /applied` · `POST /` (create) · `GET /pending-reviews` · `GET /:id` · `POST /:id/apply` · `GET /:id/applications` · `POST /:id/applications/:appId/select` · `POST /:id/topup` · `POST /:id/cancel` · `POST /:id/confirm` · `POST /:id/dispute` · `GET /:id/reviews` · `POST /:id/reviews` · `GET /:id/conversation` · `POST /:id/attachments` (multipart) · `GET /:id/attachments/:attachmentId/download`

Reputation on `POST /orders/:id/reviews`: applied **only when the reviewee was the executor** (`context === 'as_executor'`), by the `REVIEW_REPUTATION` table in `utils/reputation.js` — 5★ +30, 4★ +15, 3★ 0, 2★ −15, 1★ −30. `addReputation` clamps the result at zero and logs the applied delta. `/forum/*` grants no reputation at all (achievements only).

## `/listings` (`routes/listings.js`)
`GET /categories` · `POST /` · `GET /` (optionalAuth) · `GET /mine` · `GET /:id` · `PATCH /:id` · `PATCH /:id/toggle` · `POST /:id/order` (convert listing to order)

Buyer-facing responses (`GET /`, `GET /:id`, and `GET /profile/:id/services`) carry two computed fields on top of the row: `price_with_commission` (what the buyer is actually charged — `price` + `admin_settings.marketplace_commission_pct`) and `commission_pct`. `listings.price` itself stays the executor's take, and that's what the owner enters/edits — the two sides deliberately see different numbers for the same service. `GET /mine` is owner-facing and has neither field.

## `/wallet` (`routes/wallet.js`)
`GET /` (balance) · `GET /chart` · `POST /deposits` · `GET /deposits` · `GET /withdrawals` · `POST /withdrawals` · `GET /vip/price` · `POST /vip`

`GET /` returns `balance` plus its two halves, `deposited_balance` and `earned_balance` (see `docs/schema.md`).

`POST /withdrawals` takes `{ amount, card_number, withdrawal_method: 'sbp'|'card', source_balance: 'deposited'|'earned' }` (both enums default to `sbp`/`deposited` for older clients). Minimum by method: **СБП 500 ₽, карта 4000 ₽**. Commission by source: deposited = `admin_settings.withdrawal_commission_pct` (10), earned = 0 — flat, no level progression. **One request draws on one balance only**: the deduction goes through `try_subtract_bucket_balance`, so a mixed withdrawal is impossible by construction and a short bucket returns `400 { code: 'INSUFFICIENT_BUCKET_BALANCE' }` even when the *combined* balance would cover it. Two balances = two requests.

## `/settings` (`routes/settings.js`)
`GET /public/commissions` → `{ withdrawal_commission_pct, marketplace_commission_pct }` (auth, the two rates the UI must show before the user acts) · `GET /:key` (site_settings row). Replaced the narrower `GET /public/withdrawal-commission-pct`.

## `/conversations` (`routes/conversations.js`)
`GET /:id/messages` · `POST /:id/messages` (multipart, up to 5 files) · `GET /:id/messages/:msgId/attachments/:attId/download`

## `/profile` (`routes/profile.js`)
`GET /leaderboard` · `GET /:id/public` · `GET /:id/reviews` · `GET /:id/services` · `GET /` (own profile) · `PUT /` (update own profile)

## `/users` (`routes/users.js`)
`GET /:id` · `GET /:id/reviews`

## `/support` (`routes/support.js`)
`POST /tickets` · `GET /tickets` · `GET /tickets/:id` · `PATCH /tickets/:id/close`

## `/forum` (`routes/forum.js`)
`GET /categories` · `GET /threads` · `GET /trending-tags` · `GET /categories/:id/threads` · `GET /threads/:id` · `POST /threads` · `POST /threads/:id/view` · `GET /threads/:id/posts` (optionalAuth) · `POST /threads/:id/posts` · `DELETE /posts/:id` · `POST /posts/:id/react` · `POST /report` · `PATCH /threads/:id/lock` (requireAdmin)

`forum_categories.is_active = false` hides a category **without deleting it**: it drops out of `GET /categories`, its threads drop out of `GET /threads` (the home page's hot threads), `GET /categories/:id/threads` 404s, and `POST /threads` into it 400s. `GET /admin/forum/categories` still lists every category; the admin UI toggles the flag via `PATCH /admin/forum/categories/:id`.

## `/gost` (`routes/gost.js`) — GOST calculator token system
`GET /token-balance` · `POST /buy-tokens` · `POST /activate-key`

## `/mfa` (`routes/mfa.js`) — admin 2FA backup codes
GoTrue has no backup-code concept, so a code cannot mint an aal2 session — it **removes** the factor instead, after which password-only access works again and the admin re-enrolls. Codes are 16 chars (~79 bits) from a confusable-free alphabet, stored as sha256 hashes in `admin_mfa_backup_codes` (service_role-only RLS, migration `20260726120000`).

| Route | Gate | Notes |
|---|---|---|
| `GET /backup-codes` | `auth` + `adminMiddleware` (so aal2) | `{ total, unused, generated_at }` — never returns codes |
| `POST /backup-codes` | `auth` + `adminMiddleware` (so aal2) | Regenerates the whole set of 10, invalidating the old one. The only response that contains plaintext codes |
| `POST /recover` | `auth` only — **deliberately not** `adminMiddleware` | `{ code }`. Checks `is_admin` inline, marks the code used, deletes every verified factor via `auth.admin.mfa.deleteFactor`, then wipes remaining codes. Telegram notification on both success and failure |

`POST /recover` cannot sit behind `adminMiddleware`: that middleware demands aal2 from exactly the admins who need recovery. The code is marked used *before* the factor is deleted — a failure there burns one code (annoying) rather than leaving a live code against an already-removed factor.

## `/settings` (`routes/settings.js`)
`GET /:key`

## `/stats` (`routes/stats.js`)
`GET /public`

## `/admin` (`routes/admin.js`) — all require admin
Admin routes additionally require **aal2** (a verified second factor) when the calling admin has a verified MFA factor — otherwise they 403 with `{ code: 'MFA_REQUIRED' }`. Admins without MFA enrolled are unaffected. See `middleware/admin.js`.

Ledger/finance: `GET /ledger` · `GET /finance/summary` · `PATCH /finance/expenses`
Disputes: `GET /disputes` · `POST /disputes/:id/resolve`
Deposits/withdrawals: `GET /deposits` · `POST /deposits/:id/confirm` · `POST /deposits/:id/reject` · `GET /withdrawals` · `POST /withdrawals/:id/confirm` · `POST /withdrawals/:id/reject`
Users: `GET /users` · `PATCH /users/:id`
Orders/conversations: `GET /orders` · `GET /conversations` · `GET /contact-exchange-orders`
Support: `PATCH /support/tickets/:id/close`
Chat moderation: `GET /chat-moderation` · `PATCH /chat-moderation/:msgId/review`
Site settings: `PUT /settings/:key` · `PUT /admin-settings/:key` · `GET /settings`
Forum moderation: `GET /forum/flagged` · `POST /forum/posts/:id/approve` · `DELETE /forum/posts/:id` · `GET /forum/reports` · `POST /forum/reports/:id/resolve` · `GET /forum/categories` · `POST /forum/categories` · `PATCH /forum/categories/:id` · `DELETE /forum/categories/:id`
Stats: `GET /stats`
VIP: `GET /vip` — plans + per-level discount table (computed with the same `utils/vip.js` helpers the purchase uses, so it reflects `admin_settings.vip_level_discounts`), revenue, purchase count, active/expiring counts, and the list of active subscribers · `POST /vip/:userId/extend` (`{ days }`, 1–3650) · `POST /vip/:userId/cancel`

`extend`/`cancel` deliberately write **no** `transactions` row: a manual grant isn't a purchase, and logging it would inflate VIP revenue in `/finance/summary`. The audit trail is the Telegram notification (same channel as deposit confirmations and dispute resolutions). `cancel` sets `vip_expires_at = now()` rather than `null` — `utils/vipExpiry.js` looks for a non-null past date, so `null` would leave the user permanently outside the listing-limit sweep — and then calls `hideExcessForUser()` directly so over-limit listings hide immediately instead of waiting up to an hour.
Schedule warmup: `GET /schedule-warmup/status` · `POST /schedule-warmup/start` (`{ force? }`) · `POST /schedule-warmup/solve-captcha` · `POST /schedule-warmup/cancel` · `POST /schedule-warmup/reset`

### Paginated admin responses
`GET /ledger` and `GET /users` are **paginated envelopes**, not bare arrays:

| Endpoint | Query | Response |
|---|---|---|
| `GET /ledger` | `type`, `nickname`, `date_from`, `date_to`, `page` (1), `limit` (100, max 5000 — but PostgREST still stops at 1000, so exports page instead) | `{ entries, total, page, limit }` |
| `GET /users` | `search` (nickname **or** email), `filter=banned\|admins\|vip`, `page` (1), `limit` (50, max 500) | `{ users, total, page, limit }` |

Every filter on both runs in SQL, so `total` counts the filtered set. `/ledger`'s `nickname` used to be applied in Node *after* a hard 500-row fetch, which hid older matches; `/users` used to return every profile row plus a 1000-user page of the GoTrue admin API. Email now comes from `profiles.email` (the column `GET /profile` already reads), so no auth-admin call is involved.

`GET /stats` and `GET /finance/summary` aggregate over **all** rows via `utils/pagedFetch.js` — a single PostgREST select silently stops at `db-max-rows` (1000), and `/stats` additionally had explicit `.limit(2000)` caps. `/stats` gained `vip_users` and `orders_total`; `/finance/summary` gained `vip_revenue`, `vip_purchases_count`, `vip_active_count` (VIP purchases were missing from platform profit entirely) and `commission_marketplace` (the marketplace markup, summed off `platform_profit` on `order_payout` rows). `/stats`'s `total_commission_earned` sums both `withdrawal` and `order_payout` profit.

`GET /admin/withdrawals` computes `commission_pct` and `payout_amount` per row server-side from `source_balance` — the admin UI no longer derives the payout itself.

## Known spec deviations (see `TODO_BACKEND.md` for full detail)
- `market_orders`/`market_services` don't exist as separate concepts — use `orders`/`listings`.
- `GET /market/categories` is actually `GET /listings/categories`.
- Profile endpoints have no `/api` prefix, consistent with the rest of the API.
- GOST calculator usage is only tracked on token purchase (`POST /gost/buy-tokens`), not per-calculation, because the external GOST backend doesn't report back — see the TODO for what a real fix requires.
