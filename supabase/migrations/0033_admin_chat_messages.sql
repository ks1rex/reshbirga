-- ВНИМАНИЕ: НЕ ПРИМЕНЯТЬ. Этот файл не отражает реальное состояние живой БД
-- (btcpbvevytmhgkevhnyj) — см. docs/AUDIT_MIGRATION_SAFETY_2026.md за построчным
-- разбором безопасности и docs/AUDIT_MIGRATION_DRIFT_2026.md за объяснением,
-- почему локальная нумерация 0001-0036 разошлась с реальной историей.
-- Реальная схема применена под timestamp-версиями миграций, не под этим именем.

-- Mark messages sent by an admin through the admin chat panel.
-- Set explicitly at insert time (not inferred from sender's current is_admin,
-- which can change later) — see backend/src/routes/admin.js POST /conversations/:id/messages.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_admin_message boolean NOT NULL DEFAULT false;
