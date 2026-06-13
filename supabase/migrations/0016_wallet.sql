-- Add deposit / withdrawal to transaction_type enum
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'deposit';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'withdrawal';

-- Add wallet balance and rate-limit marker to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS balance                   numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_deposit_confirmed_at timestamptz;

-- ─── deposit_requests ────────────────────────────────────────────────────────

CREATE TABLE deposit_requests (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  claimed_amount   numeric(12,2) NOT NULL CHECK (claimed_amount > 0),
  confirmed_amount numeric(12,2),
  credited_amount  numeric(12,2),
  status           text          NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','confirmed','rejected')),
  admin_comment    text,
  processed_by     uuid          REFERENCES profiles(id) ON DELETE SET NULL,
  processed_at     timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_deposit_requests_user   ON deposit_requests(user_id);
CREATE INDEX idx_deposit_requests_status ON deposit_requests(status);

ALTER TABLE deposit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deposit_requests_select_own"
  ON deposit_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "deposit_requests_select_admin"
  ON deposit_requests FOR SELECT TO authenticated
  USING (is_admin());

-- Users insert their own requests via backend; updates only via service_role
CREATE POLICY "deposit_requests_insert_own"
  ON deposit_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ─── withdrawal_requests ─────────────────────────────────────────────────────

CREATE TABLE withdrawal_requests (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  card_number   text          NOT NULL,
  status        text          NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','confirmed','rejected')),
  admin_comment text,
  processed_by  uuid          REFERENCES profiles(id) ON DELETE SET NULL,
  processed_at  timestamptz,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_withdrawal_requests_user   ON withdrawal_requests(user_id);
CREATE INDEX idx_withdrawal_requests_status ON withdrawal_requests(status);

ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "withdrawal_requests_select_own"
  ON withdrawal_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "withdrawal_requests_select_admin"
  ON withdrawal_requests FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "withdrawal_requests_insert_own"
  ON withdrawal_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ─── Atomic balance RPCs ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_wallet_balance(p_user_id uuid, p_amount numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE profiles SET balance = balance + p_amount WHERE id = p_user_id;
$$;

-- Returns TRUE if balance was sufficient and deduction happened; FALSE otherwise.
CREATE OR REPLACE FUNCTION try_subtract_wallet_balance(p_user_id uuid, p_amount numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rows_updated integer;
BEGIN
  UPDATE profiles
  SET    balance = balance - p_amount
  WHERE  id = p_user_id AND balance >= p_amount;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;
