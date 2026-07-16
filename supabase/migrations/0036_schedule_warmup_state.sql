-- ВНИМАНИЕ: НЕ ПРИМЕНЯТЬ. Этот файл не отражает реальное состояние живой БД
-- (btcpbvevytmhgkevhnyj) — см. docs/AUDIT_MIGRATION_SAFETY_2026.md за построчным
-- разбором безопасности и docs/AUDIT_MIGRATION_DRIFT_2026.md за объяснением,
-- почему локальная нумерация 0001-0036 разошлась с реальной историей.
-- Реальная схема применена под timestamp-версиями миграций, не под этим именем.

create table if not exists schedule_warmup_state (
  id integer primary key default 1,
  status text not null default 'idle',
  -- idle | running | waiting_captcha | done | error
  captcha_image_base64 text,
  session_cookie text,
  session_cookie_verified_at timestamptz,
  progress_step text,
  progress_current integer default 0,
  progress_total integer default 0,
  last_run_at timestamptz,
  last_error text,
  constraint single_row check (id = 1)
);

insert into schedule_warmup_state (id, status)
values (1, 'idle') on conflict do nothing;
