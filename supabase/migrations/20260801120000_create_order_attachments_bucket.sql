-- orders.js uploads/signs URLs against a bucket 'order-attachments' that was
-- never actually created live (0012_storage_bucket.sql is unapplied history,
-- see CLAUDE.md "Migration history"). Every upload/download call has been
-- failing. Private bucket only, no public policy needed: routes/orders.js
-- (service-role client) already gates access to order participants/admin
-- before upload or createSignedUrl, and storage.objects has RLS enabled by
-- default with no policies here — anon/authenticated get denied
-- automatically, service role bypasses RLS regardless.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('order-attachments', 'order-attachments', false, 10485760)
ON CONFLICT (id) DO NOTHING;
