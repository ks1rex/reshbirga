-- Enums for the entire schema

CREATE TYPE order_type AS ENUM ('fixed_price', 'auction', 'scheduled');

CREATE TYPE order_status AS ENUM (
  'pending_payment',
  'open',
  'awaiting_topup',
  'assigned',
  'in_progress',
  'awaiting_confirmation',
  'completed',
  'disputed',
  'cancelled'
);

CREATE TYPE application_status AS ENUM ('pending', 'accepted', 'rejected');

CREATE TYPE attachment_visibility AS ENUM ('public', 'after_assignment');

CREATE TYPE conversation_type AS ENUM ('order_chat', 'support_ticket');

CREATE TYPE participant_role AS ENUM ('customer', 'executor', 'admin', 'support_user');

CREATE TYPE review_context AS ENUM ('as_customer', 'as_executor');

CREATE TYPE dispute_status AS ENUM (
  'open',
  'resolved_refund_customer',
  'resolved_pay_executor',
  'resolved_site_error'
);

CREATE TYPE support_ticket_status AS ENUM ('open', 'answered', 'closed');

CREATE TYPE transaction_type AS ENUM (
  'reserve',
  'refund_excess',
  'topup',
  'commission',
  'payout',
  'refund_full',
  'refund_partial'
);

CREATE TYPE transaction_status AS ENUM ('pending', 'completed', 'rejected');
