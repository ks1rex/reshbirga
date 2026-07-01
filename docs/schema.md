# Database Schema

Supabase Postgres, RLS on. Migrations in `supabase/migrations/0001`..`0027` (+ `0024b`) are sequential and already applied to the live project (`btcpbvevytmhgkevhnyj` — shared with the Sait/ГОСТ backend, see root `CLAUDE.md`). Add a new numbered file rather than editing an old one — treat them as ordered history. `supabase/migrations-ebu/` is a separate, apparently-unapplied/parked migration set — don't assume it's live. Note: `0017_wallet_webhooks.sql` hardcodes a different, stale project ref in its edge-function URL and its trigger/function were not found live on `btcpbvevytmhgkevhnyj` — the deposit/withdrawal Telegram webhook from that migration appears to have never actually been wired up here; verify before relying on it.

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

## Key functions/triggers
- `is_admin()` (0002), `update_updated_at()` (0003), `is_conversation_participant()` (0006)
- `handle_new_user()` (0011, redefined 0024 for referrals), `update_profile_ratings()` (0011)
- `handle_executor_assigned()` (0014)
- `add_balance_pending` / `subtract_balance_pending_add_available` (0015)
- `add_wallet_balance` / `try_subtract_wallet_balance` (0016) — atomic RPCs for wallet balance mutation
- `notify_deposit_insert` / `notify_withdrawal_insert` (0017) — webhook triggers
- `add_referral_earnings` (0024b)
- `update_profile_average_rating`, `grant_early_bird` (0025)

**Money paths use these RPCs, not app-level read-modify-write.** Before adding new balance-mutating code in Express, check for an existing atomic RPC above. The one exception is `addReputation` in `backend/src/utils/reputation.js` (read-then-update, flagged with a `ponytail:` comment as unsafe for anything money-related — reputation points only, not balances).

## Storage
S3-compatible bucket configured in `0012_storage_bucket.sql`, used for order/message attachments.

## RLS boundary
Every listed table has RLS enabled, but the backend's Supabase client (`backend/src/supabase_client.js`) is service-role and bypasses RLS. **Express routes are the real authorization boundary**, not the database.
