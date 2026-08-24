-- conversations.js uploads/signs URLs against a bucket 'chat-attachments' that
-- was only ever declared in 0014_chat_trigger_moderation.sql — unapplied
-- history, same situation order-attachments was in before
-- 20260801120000_create_order_attachments_bucket.sql fixed it (see
-- CLAUDE.md "Migration history"). Every chat file upload has been failing
-- silently (routes/conversations.js swallows the storage error and just
-- posts the message without the attachment). Private bucket only, no public
-- policy needed: routes/conversations.js (service-role client) already
-- gates access to conversation participants/admin before upload or
-- createSignedUrl, and storage.objects has RLS enabled by default with no
-- policies here — anon/authenticated get denied automatically, service role
-- bypasses RLS regardless.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', false, 10485760)
ON CONFLICT (id) DO NOTHING;
