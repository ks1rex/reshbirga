-- ─── 1. Merge old executor balance columns into unified wallet balance ────────
UPDATE profiles
SET balance = balance
            + COALESCE(balance_available, 0)
            + COALESCE(balance_pending,   0);

ALTER TABLE profiles
  DROP COLUMN IF EXISTS balance_available,
  DROP COLUMN IF EXISTS balance_pending;

-- Drop RPCs that referenced the dropped columns
DROP FUNCTION IF EXISTS add_balance_pending(uuid, numeric);
DROP FUNCTION IF EXISTS subtract_balance_pending_add_available(uuid, numeric);

-- ─── 2. required_topup on orders ──────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS required_topup numeric(12,2);

-- ─── 3. New transaction types for balance-based order flow ───────────────────
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'order_payment';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'order_cancel_refund';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'order_refund_excess';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'order_topup';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'order_payout';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'dispute_refund_customer';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'dispute_refund_full';
