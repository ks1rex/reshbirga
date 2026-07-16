-- ВНИМАНИЕ: НЕ ПРИМЕНЯТЬ. Этот файл не отражает реальное состояние живой БД
-- (btcpbvevytmhgkevhnyj) — см. docs/AUDIT_MIGRATION_SAFETY_2026.md за построчным
-- разбором безопасности и docs/AUDIT_MIGRATION_DRIFT_2026.md за объяснением,
-- почему локальная нумерация 0001-0036 разошлась с реальной историей.
-- Реальная схема применена под timestamp-версиями миграций, не под этим именем.

-- Stage 1 of VIP/fees plan: move platform commission from deposit to withdrawal.
-- Deposits are now credited 1:1; withdrawal_commission_pct (10%) is held on withdrawal
-- confirmation instead. deposit_commission_pct is kept for backward-compat reads but
-- zeroed out — no prod data depends on the old value.

INSERT INTO admin_settings (key, value)
VALUES ('withdrawal_commission_pct', '10')
ON CONFLICT (key) DO NOTHING;

UPDATE admin_settings SET value = '0' WHERE key = 'deposit_commission_pct';
