CREATE TABLE order_applications (
  id              uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid               NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  executor_id     uuid               NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proposed_amount numeric(12,2),
  message         text               NOT NULL,
  status          application_status NOT NULL DEFAULT 'pending',
  created_at      timestamptz        NOT NULL DEFAULT now(),
  UNIQUE (order_id, executor_id)
);

CREATE INDEX idx_applications_order    ON order_applications(order_id);
CREATE INDEX idx_applications_executor ON order_applications(executor_id);

ALTER TABLE order_applications ENABLE ROW LEVEL SECURITY;

-- Customer sees all applications for their orders
CREATE POLICY "applications_select_customer"
  ON order_applications FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM orders WHERE id = order_id AND customer_id = auth.uid())
  );

-- Executor sees their own applications
CREATE POLICY "applications_select_executor"
  ON order_applications FOR SELECT TO authenticated
  USING (executor_id = auth.uid());

-- Admin sees all
CREATE POLICY "applications_select_admin"
  ON order_applications FOR SELECT TO authenticated
  USING (is_admin());

-- Executor submits application for open orders
CREATE POLICY "applications_insert_executor"
  ON order_applications FOR INSERT TO authenticated
  WITH CHECK (
    executor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM orders WHERE id = order_id AND status = 'open')
  );

-- Executor can retract their own pending application
CREATE POLICY "applications_update_executor"
  ON order_applications FOR UPDATE TO authenticated
  USING (executor_id = auth.uid() AND status = 'pending')
  WITH CHECK (executor_id = auth.uid());

-- Customer accepts/rejects applications for their orders
CREATE POLICY "applications_update_customer"
  ON order_applications FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM orders WHERE id = order_id AND customer_id = auth.uid())
  )
  WITH CHECK (true);

-- Admin manages all applications
CREATE POLICY "applications_update_admin"
  ON order_applications FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (true);
