alter table schedule_cache enable row level security;

create policy "public_read" on schedule_cache
  for select to anon, authenticated using (true);

create policy "service_write" on schedule_cache
  for all to service_role using (true);
