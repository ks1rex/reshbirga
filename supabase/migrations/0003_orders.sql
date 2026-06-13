CREATE TABLE orders (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  executor_id           uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  title                 text         NOT NULL,
  description           text         NOT NULL,
  subject               text         NOT NULL,
  order_type            order_type   NOT NULL,
  base_amount           numeric(12,2) NOT NULL,
  final_amount          numeric(12,2),
  commission_amount     numeric(12,2),
  reserved_amount       numeric(12,2),
  status                order_status NOT NULL DEFAULT 'pending_payment',
  scheduled_at          timestamptz,
  confirmed_by_customer boolean      NOT NULL DEFAULT false,
  confirmed_by_executor boolean      NOT NULL DEFAULT false,
  confirmation_deadline timestamptz,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_executor ON orders(executor_id);
CREATE INDEX idx_orders_status   ON orders(status);
CREATE INDEX idx_orders_type     ON orders(order_type);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Customer sees their own orders (full access)
CREATE POLICY "orders_select_customer"
  ON orders FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

-- Assigned executor sees their orders (full access)
CREATE POLICY "orders_select_executor"
  ON orders FOR SELECT TO authenticated
  USING (executor_id = auth.uid());

-- All authenticated users can browse open orders
-- (join to profiles for customer info is filtered in queries to only return nickname)
CREATE POLICY "orders_select_open"
  ON orders FOR SELECT TO authenticated
  USING (status = 'open');

-- Admin sees everything
CREATE POLICY "orders_select_admin"
  ON orders FOR SELECT TO authenticated
  USING (is_admin());

-- Customer creates their own orders
CREATE POLICY "orders_insert_customer"
  ON orders FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());

-- Customer updates their own orders
CREATE POLICY "orders_update_customer"
  ON orders FOR UPDATE TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

-- Admin updates any order (disputes, manual resolution)
CREATE POLICY "orders_update_admin"
  ON orders FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (true);
