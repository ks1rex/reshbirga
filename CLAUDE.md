# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Ebu.Gubkin — student services marketplace. Customers post orders/catalog listings, executors apply, payment is held in escrow, released on confirmation, disputes are arbitrated by admins.

**Money model (rewritten 2026-07-31, see `docs/schema.md` "Two balances"):** a wallet has two halves — `deposited_balance` (top-ups) and `earned_balance` (marketplace payouts + referral bonuses); `profiles.balance` is their sum, kept by a CHECK. Spending debits deposited first, then earned. The platform earns twice: **+10% on top of the displayed price, paid by the buyer** on every order/listing (`admin_settings.marketplace_commission_pct`; the seller receives the displayed price in full, the markup is recognised at completion), and **10% on withdrawal from `deposited_balance` only** (`admin_settings.withdrawal_commission_pct`; withdrawing earned money is free). Deposits are still credited 1:1.

Repo is in Russian (UI text, commit-adjacent docs, error messages). Match that when writing user-facing strings.

## Stack

- Backend: Node.js 20 + Express, deployed as Docker to a self-hosted Timeweb
  VPS since 2026-08-26 (`backend.ebugubkin.ru`, was Render before — see root
  `CLAUDE.md` "Infrastructure")
- DB/Auth/Storage: self-hosted Supabase (Postgres + RLS + Storage on Timeweb
  S3) at `api.ebugubkin.ru`, same official `supabase/docker` stack the other
  two repos share — schema details in `@docs/schema.md`
- AI moderation: DeepSeek API (`deepseek-chat`)
- Notifications: Telegram Bot API, called synchronously from Express (`backend/src/utils/telegramNotify.js`) — an earlier Supabase Edge Function path (`notify-admin-events`) was dead code and removed (2026-07-16), see `docs/schema.md`. Current senders: `routes/admin.js` (deposit confirmed, referral bonus, dispute resolved), `routes/orders.js` (new dispute), `routes/wallet.js` (deposit/withdrawal requests), `routes/support.js` (new support ticket), `routes/conversations.js` (regex contact-info flag in a chat — currently dormant, see Stack note above), `utils/aiChatCheck.js` (AI chat flags, one digest per order), `utils/forumModerator.js` (forum AI flags), `jobs/scheduleWarmup.js` (autostart needs captcha / stuck run reset), `routes/mfa.js` (2FA removed via backup code, and failed attempts)
- `frontend/` in this repo is **deprecated and unused**. The real, active UI lives in the separate `ebu.gubkin` repository.

## Commands

Backend (`backend/`):
```bash
npm run dev          # nodemon main.js, http://localhost:3001
npm start             # no hot-reload
npm run smoke-test    # integration test, see below
```

No unit test framework configured. Correctness is verified via `backend/smoke_test.js`, a single sequential integration script (21 steps: health, user signup, deposits, order lifecycle — instant deduction / insufficient balance / auction / topup / cancel — payouts, withdrawal, VIP purchase, disputes, support tickets, ban/unban, listing limits, order visibility toggle, GOST token VIP discount). It hits a running backend + real Supabase project, creates throwaway `smoketest_*@test.local` accounts, and cleans them up in a `finally` block at the end via `cleanupTestData()` — not just the accounts, but everything they created (orders, transactions, disputes, reviews, deposit/withdrawal requests, support tickets, forum posts, and chats/messages, deleted in FK-safe order before the accounts themselves). Requires `backend/.env` filled in (needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`; `BACKEND_URL` defaults to `http://localhost:3001`). There is no way to run a single step in isolation — it's one linear script.

Health check: `GET /health` → `{ "status": "ok" }`. Full endpoint list: `@docs/api.md`.

Env vars (see `backend/.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (smoke test only), `SUPABASE_SERVICE_ROLE_KEY` (secret), `PORT`, `FRONTEND_URL` (CORS origin), `AUTO_CONFIRM_HOURS`, `DEEPSEEK_API_KEY` (secret, optional — AI moderation is skipped without it), `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`BACKEND_URL` (smoke test only).

No linter/formatter configured — match the style of surrounding code (CommonJS `require`, thin async route handlers, errors returned as `{ error: '<Russian message>' }` with the appropriate HTTP status, not thrown).

## Repo layout

```
backend/
├── main.js               # entry point
├── smoke_test.js          # integration test (see Commands)
├── Dockerfile             # built/run on the self-hosted VPS, /opt/apps/reshbirga
└── src/
    ├── app.js             # middleware stack + route mounts
    ├── routes/            # orders, admin, wallet, conversations, listings, profile, forum, gost, settings, stats, support, users, health
    ├── middleware/        # auth.js, isBanned.js, admin.js
    ├── supabase_client.js # service-role client (bypasses RLS)
    └── utils/             # contactDetector, aiChatCheck, autoConfirm, reputation, forumModerator, search, telegramNotify

supabase/
├── migrations/            # 0001-0036 (+0024b) — DO NOT trust as applied history, see "Migration history" below
└── migrations-ebu/        # parked/unapplied, don't assume live (see docs/schema.md caveat)

frontend/                  # deprecated, see Stack above — do not extend
```

## Deployment

Backend ships as a Docker image (`backend/Dockerfile`), built and run manually on the self-hosted Timeweb VPS at `/opt/apps/reshbirga` (`git pull` + `docker build` + `docker restart reshbirga-backend`); `.env` lives only on the server, not committed. There is no CI/CD workflow for the backend in this repo — no auto-deploy on push (Render, which used to provide that, is decommissioned as of 2026-08-26). The `ebu.gubkin` repo owns its own frontend deploy pipeline.

## Architecture

**No `/api` prefix.** All backend routes are mounted directly on root (`/orders`, `/wallet`, `/profile/:id/public`, etc.) — see `backend/src/app.js` for the full mount list. There is no separate "market" router; `orders` and `listings` are the real tables.

**Route → middleware → Supabase.** Routes in `backend/src/routes/*.js` are thin: auth via `backend/src/middleware/auth.js` (verifies Supabase JWT), ban check via `isBanned.js`, admin check via `admin.js`, then direct calls through `backend/src/supabase_client.js` (service-role client, bypasses RLS — so routes are the actual authorization boundary, not the DB). Shared logic lives in `backend/src/utils/`: `contactDetector.js` (regex contact-info detection — the call to it in `routes/conversations.js` is currently disabled by product decision, `hasContactInfo` hardcoded `false`; see comment there for how to re-enable), `aiChatCheck.js` (DeepSeek moderation call), `autoConfirm.js` (auto-confirms orders after `AUTO_CONFIRM_HOURS`), `reputation.js`, `forumModerator.js`, `search.js`, `telegramNotify.js`.

**Background jobs run in-process.** All kicked off directly in `app.js` — no external scheduler/queue: `startForumAIJob()` (forum AI moderation, every 10 min), `startVipExpiryJob()` (VIP expiry sweep, hourly), `startWarmupScheduleJob()` (every 15 min; a no-op unless `admin_settings.warmup_auto_hours > 0`). The warmup job doubles as the watchdog that clears a `schedule_warmup_state.status = 'running'` row whose progress has stopped moving — the cancel flag lives in-process, so a redeploy mid-run would otherwise wedge the state forever (there's also a manual `POST /admin/schedule-warmup/reset`).

**Aggregates must page.** PostgREST caps a response at `db-max-rows` (1000) *silently* — no error, just fewer rows. `backend/src/utils/pagedFetch.js` (`fetchAll`/`sumAll`) walks the pages; use it for any "sum/count everything" query. `/admin/stats` and `/admin/finance/summary` were both understating figures for exactly this reason (plus explicit `.limit(2000)` caps in `/stats`).

**Reputation is marketplace-only, and it can go down.** `utils/reputation.js` owns the whole rule: `REVIEW_REPUTATION` (5★ +30, 4★ +15, 3★ 0, 2★ −15, 1★ −30) plus +50 to the executor on order completion (`routes/orders.js`). Three constraints that are easy to break by accident:
- **Only the executor's reputation moves on a review** (`context === 'as_executor'` in `POST /orders/:id/reviews`). Reviews stay mutual — the executor still reviews the customer — but the customer's reputation is untouched, because the +50 completion bonus is the executor's only, so only the executor can offset a bad review.
- **`addReputation` clamps at zero** and logs the *applied* delta to `reputation_log`, not the requested one. Don't "simplify" the clamp away: a first order rated 1★ would otherwise push a new user negative with no way back.
- **The forum grants no reputation at all** (removed 2026-07-26 — it used to give +5/+2 for threads/replies and +10/+25 at view milestones, which let anyone farm levels and the VIP discount without working). Forum achievements stayed. `forum_threads.rep_bonus_50_given` / `rep_bonus_200_given` are now unused columns, deliberately left in place rather than migrated away.

**Money paths are not atomic where you'd expect.** `addReputation` in `backend/src/utils/reputation.js` is read-then-update, not a DB transaction — acceptable for reputation points but flagged there with a `ponytail:` comment as unsafe for anything money-related. Actual escrow/wallet balance changes go through Supabase RPCs/triggers instead — check `@docs/schema.md` for the existing atomic RPC before adding new balance-mutating code in Express.

**Admin panel** (in the `ebu.gubkin` UI) requires `profiles.is_admin = true`; first admin must be granted manually via SQL (`UPDATE profiles SET is_admin = true WHERE id = '<uuid>'`).

**Two admin tiers since 2026-08-20: owner (`is_owner`) vs rank-and-file admin.**
`is_admin` is still the base gate (`middleware/admin.js`, unchanged — 2FA check
included); `is_owner` is a second, narrower flag checked by a new
`adminMiddleware.requireOwner` export, applied as `router.use([...paths],
requireOwner)` in `routes/admin.js` to the path-prefix groups a rank-and-file
admin must **not** reach: `/ledger`, `/stats`, `/deposits`, `/withdrawals`,
`/settings`, `/admin-settings`, `/finance`, `/vip`, `/schedule-warmup`.
`/market-categories` was in this list too (added 2026-08-26) until
2026-08-28, when it was pulled back out so rank-and-file admins could reach
the new category-moderation queue mounted under the same prefix (see "Market
category self-service" below) — `requireOwner` is now applied per-route
instead, only on the three raw CRUD routes (`POST`/`PATCH`/`DELETE
/market-categories`, backing the "Категории биржи" subsection of Настройки),
not on `GET /market-categories` or anything under `/market-categories/requests`.
Two more owner-only admin sections, added
2026-08-26, don't use this list at all — `routes/news.js` and
`routes/teachers.js` are separate routers (mounted at `/news`, `/teachers`,
not under `/admin`) with their own inline `requireOwner(req, res)` helper on
each mutating route, since their `GET` routes are intentionally public
(no auth at all) unlike everything else here.

**Чаты (`GET /admin/conversations`) is owner-only via a different mechanism
than the path-prefix list** (since 2026-08-24) — it can't be, because
`Admin/Support.tsx` reuses this exact same endpoint for the (non-owner-open)
"Поддержка" ticket list. Instead the handler itself pins a non-owner caller
to `type=support_ticket` regardless of what `type` they pass in the query
string — they keep ticket browsing, but lose free browsing of order chats.
`ebu.gubkin`'s `NAV_ITEMS` still marks `/admin/conversations` (Чаты)
`ownerOnly: true` so a non-owner never sees the "browse everything" UI in
the first place; a non-owner hitting the API directly gets silently
narrowed, not 403'd.

Disputes/forum/orders/moderation/support/users and `mfa.js` (own-account
2FA) stay open to any admin. `ebu.gubkin` mirrors this in the UI (nav
filtering, `AdminRoute` path allowlist) — the backend 403 (or, for Чаты, the
silent narrowing above) is the real
boundary, the UI hiding is cosmetic on top of it.

- **`GET /admin/users`** omits `is_owner` from the response entirely (not
  `false`) when the caller isn't an owner — a rank-and-file admin can't
  distinguish an owner from another admin even by inspecting the API response.
- **`PATCH /admin/users/:id`** requires `is_owner` on the caller to touch
  `is_admin`/`is_owner` on anyone; also now rejects `is_banned` from a
  non-owner caller when the *target* is any kind of admin (`is_admin = true`)
  — a rank-and-file admin can only ban ordinary users, owners can ban anyone.
  The same rank check was retrofitted into `POST /admin/disputes/:id/resolve`'s
  `ban_customer`/`ban_executor` checkboxes, a separate code path that wrote
  `is_banned` directly and originally bypassed the `PATCH` guard.
- **`is_owner_was`** is a *permanent* "was ever granted owner" marker, distinct
  from the live `is_owner` flag — set alongside a real `is_owner = true` grant,
  cleared only by an explicit revoke (`is_owner = false` or `is_admin = false`
  via the `PATCH` route above) or direct DB access. It powers the owner's
  self-service "Смотреть как админ" toggle: **`POST /profile/view-as-admin`**
  (in `routes/profile.js`, own-account only) really flips the caller's own
  `is_owner` — this is not a UI-only simulation, owner-only routes genuinely
  403 while toggled — but never touches `is_owner_was`, so the owner can
  always restore themselves even if a step in the flow fails partway. The
  endpoint never trusts a client-supplied target state; it always re-derives
  from the freshly read DB row.
- Migrations: `20260820120000_add_owner_role.sql` (adds `is_owner`),
  `20260820130000_add_owner_was.sql` (adds `is_owner_was`, backfills existing
  owners). Neither touches RLS/`is_admin()` — both flags are checked only in
  Express, same as `is_admin` always was.

**Admin 2FA is per-admin and enforced server-side.** `middleware/auth.js` decodes the `aal` claim off the (already GoTrue-verified) JWT into `req.authAal`; `middleware/admin.js` rejects `aal1` with `{ code: 'MFA_REQUIRED' }` **only** for admins who have a verified factor (`req.user.factors`). This matters because Supabase issues a fully working `aal1` session on password alone even for MFA-enrolled accounts — without the server-side check, 2FA would be decorative. Gating only enrolled admins is deliberate: otherwise the first admin to turn MFA on locks out everyone else. Enrollment UI is Supabase's native TOTP MFA (`supabase.auth.mfa.*`) in `ebu.gubkin`'s `src/pages/Admin/TwoFactor.tsx`; the login/session challenge lives in `src/pages/Login.tsx` and `src/components/AdminRoute.tsx`. No custom secret storage, no QR library.

**Backup codes are ours, not GoTrue's** (`routes/mfa.js`, table `admin_mfa_backup_codes`). GoTrue has no backup-code concept and will not issue an `aal2` session for anything but a real TOTP — so a code *removes* the factor (`auth.admin.mfa.deleteFactor`) and the admin re-enrolls, rather than logging them in. Consequence worth remembering before "tidying up" the router: `POST /mfa/recover` must **not** sit behind `adminMiddleware`, because that middleware demands `aal2` from exactly the admins who need recovery — it does its own inline `is_admin` check instead. Codes are 16 chars (~79 bits) hashed with plain sha256 (high-entropy secret, not a password) and shown once.

**Middleware stack** (`backend/src/app.js`, in order): `helmet` (CSP/COEP disabled — this is a JSON API, no server-rendered HTML), `express-rate-limit` (300 req/min per IP, generous enough for 5s chat polling), `cors` (origin allowlist from `FRONTEND_URL`, comma-separated), `express.json()`. App trusts the first proxy hop (`trust proxy = 1`) for correct client IPs behind Caddy (the VPS's reverse proxy).

**Error handling is centralized.** A single error-handling middleware at the end of `app.js` maps `multer` file-upload errors, `err.status === 400`, and malformed-JSON body errors to `{ error: '<Russian message>' }` with the right status; anything else logs server-side and returns a generic 500. Don't add per-route try/catch that duplicates this — let errors propagate (routes use async handlers that funnel into it) unless a route needs a specific status/message.

**Order chat self-service (2026-08-28).** Both parties on an `in_progress` order now get a mutual-consent action bar in the order chat (`ebu.gubkin`'s `OrderActionsBar.tsx`, replacing the earlier separate `PriceChangeBar`/`CancelOrderBar`), covering price change, order cancellation, completion confirmation, and dispute — all four now also post a system message into the chat (`sender_id: null`), not just show in a UI panel.
- **Price change** — `orders.pending_amount`/`pending_amount_proposed_by`/`pending_amount_proposed_at` (migration `20260827200000_order_price_change.sql`) hold one active proposal at a time; `POST /orders/:id/propose-price` → `/accept`|`/decline`|`/cancel`. `pending_amount` is stored canonically as the **executor's payout** (pre-commission), same convention as `order_applications.proposed_amount` — but the customer always enters/sees the **charge** (with commission) and the executor always enters/sees the **payout** (without it); the route converts based on which role is calling. Accepting recomputes `reserved_amount` via the existing `chargeWithCommission`/`payoutFromCharge` helpers and debits/credits only the **diff** against what's already reserved (mirrors the `awaiting_topup` top-up logic in `/:id/topup`), blocking accept on insufficient customer balance rather than partially applying it.
- **Mutual cancel** — `orders.cancel_requested_by`/`cancel_requested_at` (migration `20260828120000_order_mutual_cancel.sql`), same one-active-proposal shape; `POST /orders/:id/cancel-request` → `/accept`|`/decline`|`/cancel`. Full 1:1 refund of `reserved_amount` to the customer on accept, same as the existing open-order cancel path — not to be confused with disputes, which are for disagreement rather than mutual "let's just stop."
- A price proposal and a cancel request are mutually exclusive on one order (each route 400s if the other is pending) to avoid the two interacting.
- System messages for price events encode both numbers as JSON (`SYS_PRICE::{"event":...,"payout":...,"charge":...}`, see `priceEventMessage` in `routes/orders.js`) — the frontend (`ChatWindow.tsx`'s `renderPriceEvent`) picks which number to render based on the *viewer's* role, not the proposer's, for the same reason as above (a flat string couldn't be correct for both sides at once).

**Market category self-service (2026-08-28).** Creating an order or listing (`POST /orders`, `PATCH /orders/:id`, `POST /listings`) with a `category` that doesn't case-insensitively match an existing `market_categories.name` no longer silently free-texts it — the order/listing is still created immediately with whatever the user typed (unchanged), but `utils/marketCategories.js`'s `maybeRequestNewCategory` also fires a moderation flow in parallel:
- If `DEEPSEEK_API_KEY` is set, a synchronous DeepSeek call (`callDeepSeek`, given the new name + existing category names) returns `approve`/`reject`/`unsure`. `approve` creates the real `market_categories` row immediately; `reject` reassigns the originating order/listing's `category` to the `'other'` ("Другое") fallback and leaves a rejected `market_category_requests` row; `unsure` (or no API key at all) falls through to manual review, same as before AI was added.
- `market_category_requests` (migration `20260828130000_market_category_requests.sql`) tracks `target_order_id` **or** `target_listing_id` (whichever originated it), `requested_by`, `status`, `reject_reason`. No RLS policies (service-role only, same pattern as `order-attachments`/`schedule_warmup_state`).
- Admin routes: `GET /admin/market-categories/requests?status=`, `POST /admin/market-categories/requests/:id/approve`, `POST .../reject` (body `{ reassign_to_id, reason }` — on reject, moves the target order/listing's `category` to the chosen existing category's name). **Deliberately not owner-gated** — any admin can moderate category requests, unlike creating/renaming/deleting a category directly (still owner-only, see "Two admin tiers" above). Frontend UI lives in `ebu.gubkin`'s `Admin/ChatMod.tsx` (the "Модерация" page), not `Admin/Settings.tsx`.

## Known spec deviations

Several gamification/achievement thresholds and legacy endpoint names don't map 1:1 to the original spec (e.g. GOST-calculator usage tracked per token-purchase rather than per-calculation; `early_bird` is dead in practice — trigger and function exist live but zero grants and no UI label at all, verified 2026-07-26). Full list with rationale: `TODO_BACKEND.md`.

## Migration history — read before touching `supabase/migrations/`

**The numbered files `0011_triggers.sql` through `0036_schedule_warmup_state.sql` do NOT reflect what's actually applied to the live project (`btcpbvevytmhgkevhnyj`) — do not run them, individually or via `supabase db push`.** Each of those 26 files now carries a warning comment at the top saying the same thing; this is the explanation.

**What actually happened**: reshbirga and Sait are two separate repos, each with its own local `supabase/migrations/` starting numbering at `0001`, but both linked to the *same* physical Supabase project (one shared `schema_migrations` history table, not per-repo). Two consequences:

- **`0001`–`0010`**: version numbers collide with Sait's own migrations, pushed independently. `supabase migration list` shows these as "matching" between local and remote, but that's a false match on the number only — the actual applied SQL under those versions is Sait's schema, not reshbirga's.
- **`0011`–`0036`**: reshbirga's *own* schema was really applied, just not through these files — it went in via 24 separate timestamp-versioned migrations (plus later per-object patches), not this renumbered sequence. This repo's `0011`–`0036` are a rewritten/reorganized local history that was never actually pushed under these version strings.

**Two full audits already did the forensic work — read them instead of re-deriving this:**
- `docs/AUDIT_MIGRATION_DRIFT_2026.md` — full list and description of the 24 real timestamp migrations, how the collision happened, and what each one actually does (includes the full source of `claim_referral_bonus_slot`, the RPC referenced in the security audit).
- `docs/AUDIT_MIGRATION_SAFETY_2026.md` — file-by-file safety classification of all 26 local files (`0011`–`0036`) against the real live schema: which are harmless no-ops if ever run, which fail loudly (annoying but safe), and which — `0018_balance_refactor.sql` and especially `0019_simplify_order_type.sql` — would either error out or (worse, `0019`) silently apply a real, unintended, hard-to-reverse schema change because the live schema doesn't match what the file assumes.

**Going forward: new migrations must use a timestamp-based version (`YYYYMMDDHHMMSS_description.sql`), not the next sequential number.** This sidesteps the exact collision that caused all of this — sequential numbering only works if exactly one thing in the world is allowed to push to the project, and that stopped being true here. Eight migrations have been written under this convention so far — `20260716120000_schedule_warmup_state_rls.sql`, `20260716140000_drop_webhook_secrets.sql`, `20260716160000_confirm_deposit_request_and_rpc_lockdown.sql`, `20260726120000_admin_mfa_backup_codes.sql`, `20260731120000_split_balances_and_marketplace_commission.sql`, `20260801120000_create_order_attachments_bucket.sql`, `20260820120000_add_owner_role.sql`, `20260820130000_add_owner_was.sql` — follow their naming pattern. All of them are **applied live** via `supabase db query --linked -f <file>`, never `db push`. The last one wraps itself in `BEGIN`/`COMMIT` — do the same for anything money-moving, so a failure halfway can't leave balances half-migrated.

**New rule, non-negotiable: every new money-moving RPC must ship with its `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role` in the *same* migration that creates it.** Postgres grants `EXECUTE` to `PUBLIC` by default on any new function — without an explicit revoke, a financial RPC is callable directly by any authenticated (or anon) user via PostgREST, completely bypassing `admin.js`'s `auth`+`adminMiddleware` gate. This was found live on 9 existing functions on 2026-07-16 (see Security fixes below) — don't reintroduce it.

## Security fixes 2026-07-16

Applied to the live project (`btcpbvevytmhgkevhnyj`) via `supabase db query --linked -f <file>`, not `db push` (see "Migration history" above for why). Recorded here so a future audit doesn't need to re-discover any of this.

| Migration | What it did | Why |
|---|---|---|
| `20260716120000_schedule_warmup_state_rls.sql` | `ENABLE ROW LEVEL SECURITY` on `schedule_warmup_state` + `service_role`-only policy (no public `SELECT`) | Table held a third-party `session_cookie` and `captcha_image_base64` with zero RLS — readable/writable directly via the public anon key. Frontend never reads this table (verified by grep); all access is `/admin/schedule-warmup/*` via the service-role client. |
| `20260716140000_drop_webhook_secrets.sql` | Dropped `webhook_secrets` table | Dead `notify-admin-events` mechanism: Edge Function directory removed too. The function's secret lookup used the wrong row name (`notify_admin_events` vs the seeded `notify-admin-events`), the deposit/withdrawal triggers meant to call it never actually existed live, and the row held an unrotated placeholder secret (`REPLACE_WITH_SECURE_SECRET`) since creation. Real Telegram notifications already work via a separate, working path (`telegramNotify.js`). Full writeup: `docs/schema.md`. |
| `20260716160000_confirm_deposit_request_and_rpc_lockdown.sql` | (1) New atomic RPC `confirm_deposit_request` replacing the ~9-step Express flow in `POST /admin/deposits/:id/confirm` (claim + credit + `wallet_topup_total` + referral bonus, all in one transaction — no more "confirmed but never credited" crash window). (2) `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role` on 9 functions: `add_wallet_balance`, `add_referral_earnings`, `try_subtract_wallet_balance`, `buy_gost_tokens` (both overloads), `purchase_vip`, `claim_referral_bonus_slot`, `create_deposit_request`, `increment_thread_views` — plus `confirm_deposit_request` itself, locked down from birth. | All 9 carried the default `PUBLIC` execute grant — confirmed exploitable via direct `curl` to the anon-key REST endpoint (`permission denied` only *after* this fix; before it, e.g. `purchase_vip` could be called directly with an arbitrary `p_price`, or `confirm_deposit_request` could self-confirm a fabricated deposit with zero real money sent). `is_admin()`, `is_conversation_participant()`, and Sait's `consume_tokens`/`redeem_code` were deliberately left untouched — see the rule above and `docs/AUDIT_SECURITY_2026.md`. |

Source audits for all of the above: `docs/AUDIT_SECURITY_2026.md`, `docs/AUDIT_MIGRATION_DRIFT_2026.md`, `docs/AUDIT_MIGRATION_SAFETY_2026.md`.

## Reference docs

- `@docs/schema.md` — Supabase tables, enums, RPCs/triggers, migration conventions
- `@docs/api.md` — full Express route list by router, plus known spec deviations
