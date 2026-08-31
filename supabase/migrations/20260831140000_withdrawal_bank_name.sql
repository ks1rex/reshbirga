-- Withdrawal by phone number (СБП) needs the receiving bank too — the admin
-- transfers manually and SBP requires picking the recipient's bank in the app.
ALTER TABLE withdrawal_requests ADD COLUMN bank_name text;
