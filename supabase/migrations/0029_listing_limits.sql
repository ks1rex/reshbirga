-- ВНИМАНИЕ: НЕ ПРИМЕНЯТЬ. Этот файл не отражает реальное состояние живой БД
-- (btcpbvevytmhgkevhnyj) — см. docs/AUDIT_MIGRATION_SAFETY_2026.md за построчным
-- разбором безопасности и docs/AUDIT_MIGRATION_DRIFT_2026.md за объяснением,
-- почему локальная нумерация 0001-0036 разошлась с реальной историей.
-- Реальная схема применена под timestamp-версиями миграций, не под этим именем.

-- Stage 3 of VIP/fees plan: listing/order visibility limits.

INSERT INTO admin_settings (key, value) VALUES
  ('listing_limit_base', '2'),
  ('listing_limit_vip',  '10')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_reason text NULL;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS hidden_reason text NULL;
