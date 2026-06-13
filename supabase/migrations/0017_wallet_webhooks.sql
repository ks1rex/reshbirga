-- Database webhook triggers → notify-admin-events edge function
-- Uses pg_net (always enabled on Supabase) for non-blocking HTTP calls.

CREATE OR REPLACE FUNCTION notify_deposit_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://vmoyqhuxxmkceqmauujm.supabase.co/functions/v1/notify-admin-events',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object(
      'table',  'deposit_requests',
      'type',   'INSERT',
      'record', row_to_json(NEW)
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_deposit_request_insert
  AFTER INSERT ON deposit_requests
  FOR EACH ROW EXECUTE FUNCTION notify_deposit_insert();

CREATE OR REPLACE FUNCTION notify_withdrawal_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://vmoyqhuxxmkceqmauujm.supabase.co/functions/v1/notify-admin-events',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object(
      'table',  'withdrawal_requests',
      'type',   'INSERT',
      'record', row_to_json(NEW)
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_withdrawal_request_insert
  AFTER INSERT ON withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION notify_withdrawal_insert();
