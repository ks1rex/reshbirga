# Database Schema

Supabase Postgres, RLS on. Shared project (`btcpbvevytmhgkevhnyj`, shared with the Sait/ГОСТ backend, see root `CLAUDE.md`).

## ⚠️ `supabase/migrations/0011`–`0036` do not reflect the live database — do not apply them

Despite the numbered filenames looking like sequential, already-applied history, **`0011_triggers.sql` through `0036_schedule_warmup_state.sql` were never actually run against `btcpbvevytmhgkevhnyj` under these version numbers.** Each of those 26 files now has a warning comment at the top saying the same thing. Below the table-of-contents sections in this doc still cite these file numbers (e.g. "added in 0016") — treat those as **conceptual/topical pointers to which local file covers a table**, not as a claim about what version string is actually recorded in the database.

**Root cause**: reshbirga and Sait are separate repos that each maintain their own local `supabase/migrations/`, both starting at `0001`, both linked to this one shared Supabase project (one `schema_migrations` history table for the whole project, not per-repo):
- `0001`–`0010` collide in version *number* with Sait's own independently-pushed migrations — `supabase migration list` shows these as "matching," but that's a false match on the number only; the actually-applied SQL under those versions is Sait's schema.
- `0011`–`0036` is reshbirga's own schema, genuinely applied — just via 24 separate timestamp-versioned migrations (plus later per-object patches) that were never captured as files in this repo's numbered sequence, rather than through these renumbered local files.

**Full detail, not repeated here:**
- `docs/AUDIT_MIGRATION_DRIFT_2026.md` — the 24 real timestamp migrations that actually built this schema, what each does, and the full source of `claim_referral_bonus_slot`.
- `docs/AUDIT_MIGRATION_SAFETY_2026.md` — per-file safety verdict for all 26 local files against the real live schema. Two are actively dangerous if ever run: `0018_balance_refactor.sql` (errors out immediately — references columns, `balance_available`/`balance_pending`, that don't exist live) and especially `0019_simplify_order_type.sql` (would **succeed silently** and irreversibly convert the live `order_type` column from flexible `text` to a rigid two-value enum it was never meant to have).

**New migrations must use a timestamp version (`YYYYMMDDHHMMSS_description.sql`)**, not the next sequential number — see `20260716120000_schedule_warmup_state_rls.sql` / `20260716140000_drop_webhook_secrets.sql` for the pattern. Sequential numbering only works when exactly one thing pushes to a project; that stopped being true here. `supabase/migrations-ebu/` is a separate, apparently-unapplied/parked migration set — don't assume it's live (**caveat**: this note itself was found to be wrong once already — `migrations-ebu/020_reputation_log.sql` turned out to be live, applied directly out-of-band; verify against `information_schema`/`pg_proc` rather than trusting the folder name alone if it matters for what you're doing).

**`0017_wallet_webhooks.sql` (notify-admin-events webhook) — confirmed dead, removed (2026-07-16).** This migration hardcoded a different, stale project ref in its edge-function URL, and its `notify_deposit_insert`/`notify_withdrawal_insert` trigger functions were never found live on `btcpbvevytmhgkevhnyj` (confirmed via `pg_proc` — they don't exist) — the deposit/withdrawal Telegram webhook it describes never actually ran here. Investigating further surfaced two more bugs compounding the dead-on-arrival state: (1) the Edge Function (`supabase/functions/notify-admin-events/index.ts`) looked up its shared secret by `name = 'notify_admin_events'` (underscore) while the seeded row in `webhook_secrets` was named `'notify-admin-events'` (hyphen) — the lookup always returned null, so the function 401'd unconditionally, even for a legitimate caller; and (2) even setting the name aside, `0017`'s trigger functions never sent the `x-webhook-secret` header the Edge Function expected, so the two halves never worked together as designed. On top of that, the `webhook_secrets` row held an unrotated placeholder (`REPLACE_WITH_SECURE_SECRET`) since creation — a live, never-fixed secret-in-schema exposure for a mechanism that turned out to never fire. Since real admin Telegram notifications go through a separate, working, synchronous path (`backend/src/utils/telegramNotify.js`, called directly from `backend/src/routes/admin.js`), the entire notify-admin-events mechanism was deleted as dead code: the Edge Function directory removed, and `webhook_secrets` dropped in `20260716140000_drop_webhook_secrets.sql`. `0017_wallet_webhooks.sql` itself is left in place as historical record (migrations are append-only history, not edited retroactively) but should be treated as inert — do not use it as a reference for how to wire a new webhook.

Exact columns/constraints live in the migration files; this is a table-of-contents, not a column dump.

## Enums (`0001_types.sql`)
`order_type`, `order_status`, `application_status`, `attachment_visibility`, `conversation_type`, `participant_role`, `review_context`, `dispute_status`, `support_ticket_status`, `transaction_type`, `transaction_status`. Note: `order_type` was redefined in `0019_simplify_order_type.sql` to `('order', 'service')`.

## Core tables
| Table | Added in | Notes |
|---|---|---|
| `profiles` | 0002 | user profile; `is_admin` flag (grant manually via SQL); wallet balance columns added in 0016/0018/0024/0025 (referral, levels) |
| `orders` | 0003 | order/service lifecycle; `completed_at` (0015), `category` (0025); `scheduled_at` dropped in 0019 |
| `order_applications` | 0004 | executor applications to an order |
| `order_attachments` | 0005 | file attachments, `attachment_visibility` gated |
| `conversations`, `conversation_participants`, `messages`, `message_attachments` | 0006 | chat; `messages.moderation_reviewed` (0014), AI moderation flag columns (0021) |
| `reviews` | 0007 | `review_context`-scoped ratings |
| `disputes` | 0008 | arbitration records |
| `support_tickets` | 0009 | support desk |
| `transactions` | 0010 | ledger entries, `transaction_type`/`transaction_status` |
| `site_settings` | 0013 | key/value admin-configurable settings |
| `deposit_requests`, `withdrawal_requests` | 0016 | wallet top-up/payout requests; referral fields added 0024 |
| `listings` | 0020 | marketplace listings (the "market_services" concept from spec) |
| `achievements` | 0025 | gamification |
| `market_categories` | 0025 | category taxonomy for orders/listings |
| `admin_mfa_backup_codes` | `20260726120000` | admin 2FA backup codes — sha256 hashes only, `service_role`-only RLS, written exclusively by `routes/mfa.js` |

## Key functions/triggers
- `is_admin()` (0002), `update_updated_at()` (0003), `is_conversation_participant()` (0006)
- `handle_new_user()` (0011, redefined 0024 for referrals), `update_profile_ratings()` (0011)
- `handle_executor_assigned()` (0014)
- `add_balance_pending` / `subtract_balance_pending_add_available` (0015)
- `add_wallet_balance` / `try_subtract_wallet_balance` (0016) — atomic RPCs for wallet balance mutation
- `add_referral_earnings` (0024b)
- `update_profile_average_rating`, `grant_early_bird` (0025)
- `claim_referral_bonus_slot` (real version: `20260613214919`/`referral_slot_rpc`, see "0011–0036 do not reflect the live database" above) — atomic, race-free referral-slot cap enforcement (`SELECT ... FOR UPDATE`)
- **`confirm_deposit_request`** (`20260716160000_confirm_deposit_request_and_rpc_lockdown.sql`) — atomic RPC for `POST /admin/deposits/:id/confirm`: claim + credit depositor + `wallet_topup_total` + referral bonus (calls `claim_referral_bonus_slot`) + both `transactions` ledger rows, all in one transaction. Replaced a ~9-step sequential Express flow that could leave a deposit marked `confirmed` without the depositor ever actually being credited if the process died mid-flow. See `docs/AUDIT_SECURITY_2026.md` and CLAUDE.md's "Security fixes 2026-07-16".

**Money paths use these RPCs, not app-level read-modify-write.** Before adding new balance-mutating code in Express, check for an existing atomic RPC above. The one exception is `addReputation` in `backend/src/utils/reputation.js` (read-then-update, flagged with a `ponytail:` comment as unsafe for anything money-related — reputation points only, not balances).

**Every money-moving RPC must `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` and `GRANT ... TO service_role` in the same migration that creates it** — see CLAUDE.md's "Migration history" section for why (Postgres's default grant otherwise makes it directly callable via PostgREST, bypassing the Express admin gate entirely). All RPCs listed above (except the RLS-policy helpers `is_admin()`/`is_conversation_participant()`) had this fixed on 2026-07-16.

## Storage
S3-compatible bucket configured in `0012_storage_bucket.sql`, used for order/message attachments.

## Business parameters (`admin_settings`)
Key/value table, not covered by a migration entry above since it holds tunable business params rather than schema. Current documented values: `withdrawal_commission_pct` = 10 (platform cut, held on withdrawal — see root `CLAUDE.md`), `referral_bonus_pct` = 5 (referrer's cut of a referred user's first 3 deposits, default fallback in `backend/src/routes/admin.js` line 444 if the key is unset). Check this table directly for current values before hardcoding a rate elsewhere.

`vip_level_discounts` is the one non-scalar key: ten comma-separated percents (levels 1…10), validated by the `pct_list` kind, empty/unset = the built-in default curve (`utils/vip.js` `DEFAULT_LEVEL_DISCOUNTS` — `0,10,…,80,100`). `parseLevelDiscounts` falls back to that default on anything malformed rather than pricing a subscription at zero, so a hand-edited bad value degrades instead of giving away VIP.

Accepted keys are whitelisted (with a per-key validator) in `ADMIN_SETTING_VALIDATORS`, `backend/src/routes/admin.js` — `PUT /admin/admin-settings/:key` rejects anything not listed, so a new tunable needs an entry there. Non-financial keys currently in that list: `platform_expenses` (written by `PATCH /admin/finance/expenses`, not the generic setter) and `warmup_auto_hours` (schedule-warmup autostart interval in hours; `0`/unset = off, see `jobs/scheduleWarmup.js`).

## RLS boundary
Every listed table has RLS enabled, but the backend's Supabase client (`backend/src/supabase_client.js`) is service-role and bypasses RLS. **Express routes are the real authorization boundary**, not the database.

**`admin_mfa_backup_codes`** (`20260726120000_admin_mfa_backup_codes.sql`, applied 2026-07-26) is `service_role`-only from birth: RLS on, one `for all to service_role` policy, no public `SELECT`. It stores sha256 hashes of one-time codes that *remove* an admin's TOTP factor (GoTrue can't mint aal2 from a backup code) — the frontend never reads the table, only counters and the one-time plaintext response from `POST /mfa/backup-codes`.

**`schedule_warmup_state`** (added by `0036_schedule_warmup_state.sql`'s real live counterpart, not the local file — see above) had **no RLS at all** until `20260716120000_schedule_warmup_state_rls.sql` (2026-07-16) — it held a third-party `session_cookie` and captcha image readable/writable via the public anon key. Now `service_role`-only, no public `SELECT`. See CLAUDE.md's "Security fixes 2026-07-16".
