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
