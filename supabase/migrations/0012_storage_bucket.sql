INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('order-attachments', 'order-attachments', false, 10485760)
ON CONFLICT (id) DO NOTHING;
