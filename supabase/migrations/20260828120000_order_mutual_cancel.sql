-- ⚠️ См. CLAUDE.md "Migration history" — применяется напрямую на self-hosted
-- Postgres (docker exec supabase-db psql), не через supabase CLI.
--
-- Отмена заказа в работе (in_progress) по согласию обеих сторон — та же
-- схема "одно активное предложение на заказе", что и pending_amount для
-- изменения цены (20260827200000_order_price_change.sql).
alter table orders
  add column cancel_requested_by uuid references profiles(id),
  add column cancel_requested_at timestamptz;
