-- ⚠️ См. CLAUDE.md "Migration history" — применяется напрямую на self-hosted
-- Postgres (docker exec supabase-db psql), не через supabase CLI.
--
-- Пользователи теперь могут вписать новую категорию заказа/услуги прямо при
-- создании — сам заказ/услуга создаётся с ней сразу (category — обычный
-- text, без FK, так было и раньше), но категория параллельно уходит на
-- модерацию владельцу. По итогу проверки: либо категория принимается
-- (появляется в market_categories, заказ/услуга её сохраняет), либо
-- отклоняется — тогда заказ/услуга переставляется на выбранную существующую
-- категорию.
create table market_category_requests (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  target_order_id    uuid references orders(id) on delete cascade,
  target_listing_id  uuid references listings(id) on delete cascade,
  requested_by       uuid references profiles(id) not null,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason      text,
  reviewed_by        uuid references profiles(id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now()
);

-- RLS on, без публичных политик — доступ только через service-role бэкенд
-- (те же правила, что у order-attachments/schedule_warmup_state).
alter table market_category_requests enable row level security;
