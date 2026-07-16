-- ВНИМАНИЕ: НЕ ПРИМЕНЯТЬ. Этот файл не отражает реальное состояние живой БД
-- (btcpbvevytmhgkevhnyj) — см. docs/AUDIT_MIGRATION_SAFETY_2026.md за построчным
-- разбором безопасности и docs/AUDIT_MIGRATION_DRIFT_2026.md за объяснением,
-- почему локальная нумерация 0001-0036 разошлась с реальной историей.
-- Реальная схема применена под timestamp-версиями миграций, не под этим именем.

create table if not exists schedule_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text unique not null,
  data jsonb not null,
  expires_at timestamptz not null,
  last_accessed timestamptz default now(),
  created_at timestamptz default now()
);

alter table profiles
  add column if not exists schedule_group_id integer,
  add column if not exists schedule_faculty_id integer,
  add column if not exists schedule_study_id integer default 62;
