-- ── 1. Add contact-exchange + deposit fields to orders ───────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS requires_contact_exchange boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_exchange_reason   text,
  ADD COLUMN IF NOT EXISTS deposit_amount            numeric(12,2) NOT NULL DEFAULT 0;

-- ── 2. listings table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title                     text NOT NULL,
  description               text NOT NULL,
  price                     numeric(12,2) NOT NULL,
  deposit_amount            numeric(12,2) NOT NULL DEFAULT 0,
  requires_contact_exchange boolean NOT NULL DEFAULT false,
  contact_exchange_reason   text,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_owner    ON listings(owner_id);
CREATE INDEX IF NOT EXISTS idx_listings_active   ON listings(is_active);

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "listings_select"
  ON listings FOR SELECT TO authenticated
  USING (
    is_active = true
    OR owner_id = auth.uid()
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "listings_insert"
  ON listings FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "listings_update"
  ON listings FOR UPDATE TO authenticated
  USING  (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ── 3. New transaction types ──────────────────────────────────────────────────
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'deposit_hold';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'deposit_release';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'deposit_forfeit';

-- ── 4. messages.sender_id already nullable — verify, nothing to change ────────
-- sender_id uuid REFERENCES profiles(id) ON DELETE SET NULL (no NOT NULL constraint)
-- System messages use sender_id = NULL, inserted via service-role (bypasses RLS).
