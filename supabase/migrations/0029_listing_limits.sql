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
