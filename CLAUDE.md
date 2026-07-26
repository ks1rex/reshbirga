# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

СтудБиржа — student services marketplace. Customers post orders/catalog listings, executors apply, payment is held in escrow, released on confirmation, disputes are arbitrated by admins. Platform takes a 10% commission, held on **withdrawal** (not on deposit — deposits are credited 1:1; rate in `admin_settings.withdrawal_commission_pct`).

Repo is in Russian (UI text, commit-adjacent docs, error messages). Match that when writing user-facing strings.

## Stack

- Backend: Node.js 20 + Express, deployed to Render as Docker
- DB/Auth/Storage: Supabase (Postgres + RLS + S3 storage) — schema details in `@docs/schema.md`
- AI moderation: DeepSeek API (`deepseek-chat`)
- Notifications: Telegram Bot API, called synchronously from Express (`backend/src/utils/telegramNotify.js`) — an earlier Supabase Edge Function path (`notify-admin-events`) was dead code and removed (2026-07-16), see `docs/schema.md`. Current senders: `routes/admin.js` (deposit confirmed, referral bonus, dispute resolved), `routes/orders.js` (new dispute), `routes/wallet.js` (deposit/withdrawal requests), `routes/support.js` (new support ticket), `routes/conversations.js` (regex contact-info flag in a chat), `utils/aiChatCheck.js` (AI chat flags, one digest per order), `utils/forumModerator.js` (forum AI flags), `jobs/scheduleWarmup.js` (autostart needs captcha / stuck run reset), `routes/mfa.js` (2FA removed via backup code, and failed attempts)
- `frontend/` in this repo is **deprecated and unused**. The real, active UI lives in the separate `ebu.gubkin` repository.

## Commands

Backend (`backend/`):
```bash
npm run dev          # nodemon main.js, http://localhost:3001
npm start             # no hot-reload
npm run smoke-test    # integration test, see below
```

No unit test framework configured. Correctness is verified via `backend/smoke_test.js`, a single sequential integration script (17 steps: health, user signup, deposits, order lifecycle — instant deduction / insufficient balance / auction / topup / cancel — payouts, withdrawal, disputes, support tickets, ban/unban). It hits a running backend + real Supabase project, creates throwaway `smoketest_*@test.local` accounts, and cleans them up at the end. Requires `backend/.env` filled in (needs `SUPABASE_ANON_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `BACKEND_URL`). There is no way to run a single step in isolation — it's one linear script.

Health check: `GET /health` → `{ "status": "ok" }`. Full endpoint list: `@docs/api.md`.

Env vars (see `backend/.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (smoke test only), `SUPABASE_SERVICE_ROLE_KEY` (secret), `PORT`, `FRONTEND_URL` (CORS origin), `AUTO_CONFIRM_HOURS`, `DEEPSEEK_API_KEY` (secret, optional — AI moderation is skipped without it), `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`BACKEND_URL` (smoke test only).

No linter/formatter configured — match the style of surrounding code (CommonJS `require`, thin async route handlers, errors returned as `{ error: '<Russian message>' }` with the appropriate HTTP status, not thrown).

## Repo layout

```
backend/
├── main.js               # entry point
├── smoke_test.js          # integration test (see Commands)
├── Dockerfile             # Render deploy target
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

Backend ships as a Docker image (`backend/Dockerfile`) to Render; env vars are set in the Render dashboard, not committed. There is no CI/CD workflow for the backend in this repo — deploys are triggered from Render directly on push. The `ebu.gubkin` repo owns its own frontend deploy pipeline.

## Architecture

**No `/api` prefix.** All backend routes are mounted directly on root (`/orders`, `/wallet`, `/profile/:id/public`, etc.) — see `backend/src/app.js` for the full mount list. There is no separate "market" router; `orders` and `listings` are the real tables.

**Route → middleware → Supabase.** Routes in `backend/src/routes/*.js` are thin: auth via `backend/src/middleware/auth.js` (verifies Supabase JWT), ban check via `isBanned.js`, admin check via `admin.js`, then direct calls through `backend/src/supabase_client.js` (service-role client, bypasses RLS — so routes are the actual authorization boundary, not the DB). Shared logic lives in `backend/src/utils/`: `contactDetector.js` (regex contact-info detection), `aiChatCheck.js` (DeepSeek moderation call), `autoConfirm.js` (auto-confirms orders after `AUTO_CONFIRM_HOURS`), `reputation.js`, `forumModerator.js`, `search.js`, `telegramNotify.js`.

**Background jobs run in-process.** All kicked off directly in `app.js` — no external scheduler/queue: `startForumAIJob()` (forum AI moderation, every 10 min), `startVipExpiryJob()` (VIP expiry sweep, hourly), `startWarmupScheduleJob()` (every 15 min; a no-op unless `admin_settings.warmup_auto_hours > 0`). The warmup job doubles as the watchdog that clears a `schedule_warmup_state.status = 'running'` row whose progress has stopped moving — the cancel flag lives in-process, so a redeploy mid-run would otherwise wedge the state forever (there's also a manual `POST /admin/schedule-warmup/reset`).

**Aggregates must page.** PostgREST caps a response at `db-max-rows` (1000) *silently* — no error, just fewer rows. `backend/src/utils/pagedFetch.js` (`fetchAll`/`sumAll`) walks the pages; use it for any "sum/count everything" query. `/admin/stats` and `/admin/finance/summary` were both understating figures for exactly this reason (plus explicit `.limit(2000)` caps in `/stats`).

**Reputation is marketplace-only, and it can go down.** `utils/reputation.js` owns the whole rule: `REVIEW_REPUTATION` (5★ +30, 4★ +15, 3★ 0, 2★ −15, 1★ −30) plus +50 to the executor on order completion (`routes/orders.js`). Three constraints that are easy to break by accident:
- **Only the executor's reputation moves on a review** (`context === 'as_executor'` in `POST /orders/:id/reviews`). Reviews stay mutual — the executor still reviews the customer — but the customer's reputation is untouched, because the +50 completion bonus is the executor's only, so only the executor can offset a bad review.
- **`addReputation` clamps at zero** and logs the *applied* delta to `reputation_log`, not the requested one. Don't "simplify" the clamp away: a first order rated 1★ would otherwise push a new user negative with no way back.
- **The forum grants no reputation at all** (removed 2026-07-26 — it used to give +5/+2 for threads/replies and +10/+25 at view milestones, which let anyone farm levels and the VIP discount without working). Forum achievements stayed. `forum_threads.rep_bonus_50_given` / `rep_bonus_200_given` are now unused columns, deliberately left in place rather than migrated away.

**Money paths are not atomic where you'd expect.** `addReputation` in `backend/src/utils/reputation.js` is read-then-update, not a DB transaction — acceptable for reputation points but flagged there with a `ponytail:` comment as unsafe for anything money-related. Actual escrow/wallet balance changes go through Supabase RPCs/triggers instead — check `@docs/schema.md` for the existing atomic RPC before adding new balance-mutating code in Express.

**Admin panel** (in the `ebu.gubkin` UI) requires `profiles.is_admin = true`; first admin must be granted manually via SQL (`UPDATE profiles SET is_admin = true WHERE id = '<uuid>'`).

**Admin 2FA is per-admin and enforced server-side.** `middleware/auth.js` decodes the `aal` claim off the (already GoTrue-verified) JWT into `req.authAal`; `middleware/admin.js` rejects `aal1` with `{ code: 'MFA_REQUIRED' }` **only** for admins who have a verified factor (`req.user.factors`). This matters because Supabase issues a fully working `aal1` session on password alone even for MFA-enrolled accounts — without the server-side check, 2FA would be decorative. Gating only enrolled admins is deliberate: otherwise the first admin to turn MFA on locks out everyone else. Enrollment UI is Supabase's native TOTP MFA (`supabase.auth.mfa.*`) in `ebu.gubkin`'s `src/pages/Admin/TwoFactor.tsx`; the login/session challenge lives in `src/pages/Login.tsx` and `src/components/AdminRoute.tsx`. No custom secret storage, no QR library.

**Backup codes are ours, not GoTrue's** (`routes/mfa.js`, table `admin_mfa_backup_codes`). GoTrue has no backup-code concept and will not issue an `aal2` session for anything but a real TOTP — so a code *removes* the factor (`auth.admin.mfa.deleteFactor`) and the admin re-enrolls, rather than logging them in. Consequence worth remembering before "tidying up" the router: `POST /mfa/recover` must **not** sit behind `adminMiddleware`, because that middleware demands `aal2` from exactly the admins who need recovery — it does its own inline `is_admin` check instead. Codes are 16 chars (~79 bits) hashed with plain sha256 (high-entropy secret, not a password) and shown once.

**Middleware stack** (`backend/src/app.js`, in order): `helmet` (CSP/COEP disabled — this is a JSON API, no server-rendered HTML), `express-rate-limit` (300 req/min per IP, generous enough for 5s chat polling), `cors` (origin allowlist from `FRONTEND_URL`, comma-separated), `express.json()`. App trusts the first proxy hop (`trust proxy = 1`) for correct client IPs behind Render.

**Error handling is centralized.** A single error-handling middleware at the end of `app.js` maps `multer` file-upload errors, `err.status === 400`, and malformed-JSON body errors to `{ error: '<Russian message>' }` with the right status; anything else logs server-side and returns a generic 500. Don't add per-route try/catch that duplicates this — let errors propagate (routes use async handlers that funnel into it) unless a route needs a specific status/message.

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

**Going forward: new migrations must use a timestamp-based version (`YYYYMMDDHHMMSS_description.sql`), not the next sequential number.** This sidesteps the exact collision that caused all of this — sequential numbering only works if exactly one thing in the world is allowed to push to the project, and that stopped being true here. Three migrations have been written under this convention so far — `20260716120000_schedule_warmup_state_rls.sql`, `20260716140000_drop_webhook_secrets.sql`, `20260716160000_confirm_deposit_request_and_rpc_lockdown.sql` — follow their naming pattern.

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
