CREATE TABLE support_tickets (
  id         uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid                  NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  subject    text                  NOT NULL,
  status     support_ticket_status NOT NULL DEFAULT 'open',
  created_at timestamptz           NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_user   ON support_tickets(user_id);
CREATE INDEX idx_tickets_status ON support_tickets(status);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Users see their own tickets
CREATE POLICY "tickets_select_own"
  ON support_tickets FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admin sees all tickets
CREATE POLICY "tickets_select_admin"
  ON support_tickets FOR SELECT TO authenticated
  USING (is_admin());

-- Any authenticated user can open a ticket
CREATE POLICY "tickets_insert"
  ON support_tickets FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Only admin can update ticket status
CREATE POLICY "tickets_update_admin"
  ON support_tickets FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (true);
