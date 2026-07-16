-- SECURITY: schedule_warmup_state was created in 0036 without RLS. It holds
-- session_cookie (a third-party session token) and captcha_image_base64 with
-- no row-level protection — under default Supabase grants this is readable/
-- writable directly via the public anon key.
--
-- No public SELECT policy is added: this table is never read by the frontend
-- (verified — no reference to schedule_warmup_state anywhere in ebu.gubkin/src).
-- All access goes through reshbirga's POST/GET /admin/schedule-warmup/* routes
-- (backend/src/routes/admin.js), which are gated by router.use(auth, adminMiddleware)
-- and read/write this table exclusively via the service-role client
-- (backend/src/jobs/scheduleWarmup.js, `require('../supabase_client')`).

alter table schedule_warmup_state enable row level security;

create policy "service_write" on schedule_warmup_state
  for all to service_role using (true);
