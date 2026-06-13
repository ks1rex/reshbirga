-- Add completed_at to orders (confirmed_by_* and confirmation_deadline already exist from 0003)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Atomic RPC: executor earns money
CREATE OR REPLACE FUNCTION add_balance_pending(p_user_id uuid, p_amount numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE profiles SET balance_pending = balance_pending + p_amount WHERE id = p_user_id;
$$;

-- Atomic RPC: admin confirms payout → moves from pending to available
CREATE OR REPLACE FUNCTION subtract_balance_pending_add_available(p_user_id uuid, p_amount numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE profiles SET
    balance_pending   = GREATEST(0, balance_pending - p_amount),
    balance_available = balance_available + p_amount
  WHERE id = p_user_id;
$$;
