CREATE TABLE transactions (
  id            uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid               NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  order_id      uuid               REFERENCES orders(id) ON DELETE SET NULL,
  type          transaction_type   NOT NULL,
  amount        numeric(12,2)      NOT NULL,
  status        transaction_status NOT NULL DEFAULT 'pending',
  processed_by  uuid               REFERENCES profiles(id) ON DELETE SET NULL,
  admin_comment text,
  created_at    timestamptz        NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_user   ON transactions(user_id);
CREATE INDEX idx_transactions_order  ON transactions(order_id);
CREATE INDEX idx_transactions_status ON transactions(status);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Users see only their own transactions
CREATE POLICY "transactions_select_own"
  ON transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admin sees all transactions
CREATE POLICY "transactions_select_admin"
  ON transactions FOR SELECT TO authenticated
  USING (is_admin());

-- All writes go through backend service_role (no client-side inserts/updates)
