-- Резервные коды для админского 2FA (TOTP через Supabase Auth).
--
-- Зачем: GoTrue не умеет backup codes, поэтому при потере аутентификатора
-- фактор снимался только руками через панель Supabase. Здесь лежат хеши
-- одноразовых кодов; предъявление кода снимает фактор (POST /mfa/recover),
-- после чего админ подключает 2FA заново. Кодом нельзя получить aal2-сессию —
-- GoTrue выдаёт её только за реальный TOTP, поэтому код именно «снять фактор».
--
-- Хранится хеш (sha256), не сам код: коды случайные, 80 бит энтропии —
-- солить и растягивать нечего, это не пароль (см. utils/mfaBackupCodes.js).
--
-- Доступ: только service_role. Таблицу читает и пишет исключительно бэкенд
-- (backend/src/routes/mfa.js) через сервисный клиент; фронтенд к ней
-- не обращается вообще — ему возвращаются только счётчики и разовый
-- показ свежесгенерированных кодов.

create table if not exists admin_mfa_backup_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_mfa_backup_codes_user_idx
  on admin_mfa_backup_codes (user_id);

-- Один и тот же хеш дважды для одного человека не имеет смысла и мешал бы
-- «пометить использованным» однозначно.
create unique index if not exists admin_mfa_backup_codes_user_hash_idx
  on admin_mfa_backup_codes (user_id, code_hash);

alter table admin_mfa_backup_codes enable row level security;

create policy "service_write" on admin_mfa_backup_codes
  for all to service_role using (true);
