-- ── 1. Convert order_type column to text so we can swap the enum ──────────────
ALTER TABLE orders ALTER COLUMN order_type TYPE text;

-- ── 2. Migrate all existing order_type values → 'order' ──────────────────────
UPDATE orders SET order_type = 'order'
WHERE order_type IN ('fixed_price', 'auction', 'scheduled');

-- ── 3. Drop the old enum ──────────────────────────────────────────────────────
DROP TYPE IF EXISTS order_type;

-- ── 4. Create the new simplified enum ────────────────────────────────────────
CREATE TYPE order_type AS ENUM ('order', 'service');

-- ── 5. Cast the column back to the new enum ───────────────────────────────────
ALTER TABLE orders
  ALTER COLUMN order_type TYPE order_type USING order_type::order_type;

-- ── 6. Drop scheduled_at — time/details go in description ────────────────────
ALTER TABLE orders DROP COLUMN IF EXISTS scheduled_at;

-- ── 7. Remove pending_payment from order_status (no longer created) ───────────
-- Cannot remove from enum; keep it in the type for old data compatibility.
-- New code never writes pending_payment.
