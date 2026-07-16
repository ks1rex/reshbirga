-- ВНИМАНИЕ: НЕ ПРИМЕНЯТЬ. Этот файл не отражает реальное состояние живой БД
-- (btcpbvevytmhgkevhnyj) — см. docs/AUDIT_MIGRATION_SAFETY_2026.md за построчным
-- разбором безопасности и docs/AUDIT_MIGRATION_DRIFT_2026.md за объяснением,
-- почему локальная нумерация 0001-0036 разошлась с реальной историей.
-- Реальная схема применена под timestamp-версиями миграций, не под этим именем.

CREATE TABLE site_settings (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text        UNIQUE NOT NULL,
  value      text        NOT NULL DEFAULT '',
  updated_by uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO site_settings (key, value) VALUES ('payment_requisites', '');

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_select_authenticated"
  ON site_settings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "settings_insert_admin"
  ON site_settings FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "settings_update_admin"
  ON site_settings FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (true);
