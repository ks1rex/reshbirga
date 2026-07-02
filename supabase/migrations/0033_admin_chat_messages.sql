-- Mark messages sent by an admin through the admin chat panel.
-- Set explicitly at insert time (not inferred from sender's current is_admin,
-- which can change later) — see backend/src/routes/admin.js POST /conversations/:id/messages.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_admin_message boolean NOT NULL DEFAULT false;
