CREATE TABLE reviews (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid           NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  reviewer_id uuid           NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  reviewee_id uuid           NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  context     review_context NOT NULL,
  rating      smallint       NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (order_id, reviewer_id, context)
);

CREATE INDEX idx_reviews_reviewee ON reviews(reviewee_id);
CREATE INDEX idx_reviews_order    ON reviews(order_id);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Reviews are public (visible to all authenticated users)
CREATE POLICY "reviews_select"
  ON reviews FOR SELECT TO authenticated
  USING (true);

-- Only order parties can leave reviews, only after completion
CREATE POLICY "reviews_insert"
  ON reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
        AND o.status = 'completed'
        AND (o.customer_id = auth.uid() OR o.executor_id = auth.uid())
    )
  );

-- Reviews are immutable; only admin can delete via service_role
