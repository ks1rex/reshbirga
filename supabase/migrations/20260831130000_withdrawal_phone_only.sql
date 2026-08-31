-- Withdrawal simplified to a single method (phone number only, СБП-style) —
-- no more sbp/card choice, so withdrawal_method has nothing left to encode
-- and card_number was only ever a card number for the now-removed card
-- method. Renaming rather than adding a new column: existing rows already
-- hold either a phone or a card number under the old freeform field, and
-- there's no card data worth keeping separate now that card withdrawal is gone.
ALTER TABLE withdrawal_requests RENAME COLUMN card_number TO phone_number;
ALTER TABLE withdrawal_requests DROP COLUMN withdrawal_method;

-- Deposited-balance withdrawal commission raised 10% -> 15%
-- (admin_settings.withdrawal_commission_pct; earned_balance stays 0%).
-- Avoids ON CONFLICT: admin_settings' real live schema isn't in this repo's
-- migration history (see CLAUDE.md "Migration history"), so its key column's
-- constraints aren't something to assume here.
UPDATE admin_settings SET value = '15' WHERE key = 'withdrawal_commission_pct';
INSERT INTO admin_settings (key, value)
SELECT 'withdrawal_commission_pct', '15'
WHERE NOT EXISTS (SELECT 1 FROM admin_settings WHERE key = 'withdrawal_commission_pct');
