CREATE TABLE disputes (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid           NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  opened_by     uuid           NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  reason        text           NOT NULL,
  status        dispute_status NOT NULL DEFAULT 'open',
  admin_comment text,
  resolved_by   uuid           REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at   timestamptz,
  created_at    timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX idx_disputes_order  ON disputes(order_id);
CREATE INDEX idx_disputes_status ON disputes(status);

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- Order parties see their disputes
CREATE POLICY "disputes_select_parties"
  ON disputes FOR SELECT TO authenticated
  USING (
    opened_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
        AND (o.customer_id = auth.uid() OR o.executor_id = auth.uid())
    )
  );

-- Admin sees all disputes
CREATE POLICY "disputes_select_admin"
  ON disputes FOR SELECT TO authenticated
  USING (is_admin());

-- Order parties can open a dispute when order is in progress or awaiting confirmation
CREATE POLICY "disputes_insert"
  ON disputes FOR INSERT TO authenticated
  WITH CHECK (
    opened_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
        AND o.status IN ('in_progress', 'awaiting_confirmation')
        AND (o.customer_id = auth.uid() OR o.executor_id = auth.uid())
    )
  );

-- Only admin can resolve disputes
CREATE POLICY "disputes_update_admin"
  ON disputes FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (true);
