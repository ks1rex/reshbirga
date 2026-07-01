# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

СтудБиржа — student services marketplace. Customers post orders/catalog listings, executors apply, payment is held in escrow, released on confirmation, disputes are arbitrated by admins. Platform takes 10% commission on wallet deposits.

Repo is in Russian (UI text, commit-adjacent docs, error messages). Match that when writing user-facing strings.

## Stack

- Backend: Node.js 20 + Express, deployed to Render as Docker
- DB/Auth/Storage: Supabase (Postgres + RLS + S3 storage) — schema details in `@docs/schema.md`
- AI moderation: DeepSeek API (`deepseek-chat`)
- Notifications: Telegram Bot API via a Supabase Edge Function
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
├── migrations/            # 0001-0025 (+0024b), sequential, already applied
├── migrations-ebu/        # parked/unapplied, don't assume live
└── functions/notify-admin-events/  # Edge Function: Telegram notifications

frontend/                  # deprecated, see Stack above — do not extend
```

## Deployment

Backend ships as a Docker image (`backend/Dockerfile`) to Render; env vars are set in the Render dashboard, not committed. There is no CI/CD workflow for the backend in this repo — deploys are triggered from Render directly on push. The `ebu.gubkin` repo owns its own frontend deploy pipeline.

## Architecture

**No `/api` prefix.** All backend routes are mounted directly on root (`/orders`, `/wallet`, `/profile/:id/public`, etc.) — see `backend/src/app.js` for the full mount list. There is no separate "market" router; `orders` and `listings` are the real tables.

**Route → middleware → Supabase.** Routes in `backend/src/routes/*.js` are thin: auth via `backend/src/middleware/auth.js` (verifies Supabase JWT), ban check via `isBanned.js`, admin check via `admin.js`, then direct calls through `backend/src/supabase_client.js` (service-role client, bypasses RLS — so routes are the actual authorization boundary, not the DB). Shared logic lives in `backend/src/utils/`: `contactDetector.js` (regex contact-info detection), `aiChatCheck.js` (DeepSeek moderation call), `autoConfirm.js` (auto-confirms orders after `AUTO_CONFIRM_HOURS`), `reputation.js`, `forumModerator.js`, `search.js`, `telegramNotify.js`.

**Background jobs run in-process.** `startForumAIJob()` (forum AI moderation, every 10 min) is kicked off directly in `app.js` — no external scheduler/queue.

**Money paths are not atomic where you'd expect.** `addReputation` in `backend/src/utils/reputation.js` is read-then-update, not a DB transaction — acceptable for reputation points but flagged there with a `ponytail:` comment as unsafe for anything money-related. Actual escrow/wallet balance changes go through Supabase RPCs/triggers instead — check `@docs/schema.md` for the existing atomic RPC before adding new balance-mutating code in Express.

**Admin panel** (in the `ebu.gubkin` UI) requires `profiles.is_admin = true`; first admin must be granted manually via SQL (`UPDATE profiles SET is_admin = true WHERE id = '<uuid>'`).

**Middleware stack** (`backend/src/app.js`, in order): `helmet` (CSP/COEP disabled — this is a JSON API, no server-rendered HTML), `express-rate-limit` (300 req/min per IP, generous enough for 5s chat polling), `cors` (origin allowlist from `FRONTEND_URL`, comma-separated), `express.json()`. App trusts the first proxy hop (`trust proxy = 1`) for correct client IPs behind Render.

**Error handling is centralized.** A single error-handling middleware at the end of `app.js` maps `multer` file-upload errors, `err.status === 400`, and malformed-JSON body errors to `{ error: '<Russian message>' }` with the right status; anything else logs server-side and returns a generic 500. Don't add per-route try/catch that duplicates this — let errors propagate (routes use async handlers that funnel into it) unless a route needs a specific status/message.

## Known spec deviations

Several gamification/achievement thresholds and legacy endpoint names don't map 1:1 to the original spec (e.g. GOST-calculator usage tracked per token-purchase rather than per-calculation, `early_bird` measured from the first account's `created_at` rather than a configured launch date). Full list with rationale: `TODO_BACKEND.md`.

## Reference docs

- `@docs/schema.md` — Supabase tables, enums, RPCs/triggers, migration conventions
- `@docs/api.md` — full Express route list by router, plus known spec deviations
