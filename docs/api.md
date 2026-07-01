# API Endpoints

No `/api` prefix — all routers are mounted directly on root in `backend/src/app.js`. Auth is a Supabase JWT verified by `backend/src/middleware/auth.js` (`auth` = required, `optionalAuth` = attaches user if present); `isBanned` blocks banned users; `requireAdmin`/admin routes require `profiles.is_admin = true`.

`GET /health` → `{ "status": "ok" }`.

## `/orders` (`routes/orders.js`)
`GET /` (list, optionalAuth) · `GET /mine` · `GET /applied` · `POST /` (create) · `GET /pending-reviews` · `GET /:id` · `POST /:id/apply` · `GET /:id/applications` · `POST /:id/applications/:appId/select` · `POST /:id/topup` · `POST /:id/cancel` · `POST /:id/confirm` · `POST /:id/dispute` · `GET /:id/reviews` · `POST /:id/reviews` · `GET /:id/conversation` · `POST /:id/attachments` (multipart) · `GET /:id/attachments/:attachmentId/download`

## `/listings` (`routes/listings.js`)
`GET /categories` · `POST /` · `GET /` (optionalAuth) · `GET /mine` · `GET /:id` · `PATCH /:id` · `PATCH /:id/toggle` · `POST /:id/order` (convert listing to order)

## `/wallet` (`routes/wallet.js`)
`GET /` (balance) · `GET /chart` · `POST /deposits` · `GET /deposits` · `GET /withdrawals` · `POST /withdrawals`

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

## `/gost` (`routes/gost.js`) — GOST calculator token system
`GET /token-balance` · `POST /buy-tokens` · `POST /activate-key`

## `/settings` (`routes/settings.js`)
`GET /:key`

## `/stats` (`routes/stats.js`)
`GET /public`

## `/admin` (`routes/admin.js`) — all require admin
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

## Known spec deviations (see `TODO_BACKEND.md` for full detail)
- `market_orders`/`market_services` don't exist as separate concepts — use `orders`/`listings`.
- `GET /market/categories` is actually `GET /listings/categories`.
- Profile endpoints have no `/api` prefix, consistent with the rest of the API.
- GOST calculator usage is only tracked on token purchase (`POST /gost/buy-tokens`), not per-calculation, because the external GOST backend doesn't report back — see the TODO for what a real fix requires.
