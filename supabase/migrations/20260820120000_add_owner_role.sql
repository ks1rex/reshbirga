-- Two-tier admin roles: owner (full access) vs admin (restricted subset,
-- enforced in Express — see backend/src/middleware/admin.js requireOwner
-- and the owner-only route groups in backend/src/routes/admin.js).
-- Deliberately not touching is_admin/is_admin()/RLS: is_owner is only
-- checked in application code, not in any policy, so no RLS changes needed.

ALTER TABLE profiles ADD COLUMN is_owner boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.is_owner IS
  'Full admin (owner). is_admin is still required for both owner and regular '
  'admin — is_owner narrows/widens access within the existing admin gate. '
  'Checked only in Express (backend/src/middleware/admin.js), not in RLS.';

-- Manual step after applying: promote the actual owner account(s), e.g.
--   UPDATE profiles SET is_owner = true WHERE id = '<owner uuid>';
