CREATE TABLE order_attachments (
  id          uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid                  NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  uploaded_by uuid                  NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  file_path   text                  NOT NULL,
  file_name   text                  NOT NULL,
  file_size   bigint                NOT NULL,
  visibility  attachment_visibility NOT NULL DEFAULT 'public',
  created_at  timestamptz           NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_order ON order_attachments(order_id);

ALTER TABLE order_attachments ENABLE ROW LEVEL SECURITY;

-- Public attachments visible to anyone who can see the order (open or party)
CREATE POLICY "attachments_select_public"
  ON order_attachments FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
        AND (o.status = 'open' OR o.customer_id = auth.uid() OR o.executor_id = auth.uid())
    )
  );

-- After-assignment attachments only for order parties
CREATE POLICY "attachments_select_assigned"
  ON order_attachments FOR SELECT TO authenticated
  USING (
    visibility = 'after_assignment'
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
        AND (o.customer_id = auth.uid() OR o.executor_id = auth.uid())
    )
  );

-- Admin sees all
CREATE POLICY "attachments_select_admin"
  ON order_attachments FOR SELECT TO authenticated
  USING (is_admin());

-- Order parties can upload attachments
CREATE POLICY "attachments_insert"
  ON order_attachments FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
        AND (o.customer_id = auth.uid() OR o.executor_id = auth.uid())
    )
  );
