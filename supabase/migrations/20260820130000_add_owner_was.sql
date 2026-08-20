-- "Смотреть как админ" для владельца: не витрина на фронте, а настоящее
-- временное снятие is_owner (реальные 403 на owner-only маршрутах во время
-- демо-режима). is_owner_was — постоянный маркер "когда-то был владельцем",
-- ставится вместе с is_owner=true при реальной выдаче и снимается только
-- явным отзывом другим владельцем (или напрямую в БД) — самостоятельное
-- переключение через POST /profile/view-as-admin его не трогает. Именно
-- он решает, разрешено ли восстановить себе is_owner=true через тумблер.
ALTER TABLE profiles ADD COLUMN is_owner_was boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.is_owner_was IS
  'Permanent "was ever granted owner" marker. Set true alongside is_owner=true '
  'on a real grant (PATCH /admin/users/:id by another owner); cleared only by '
  'an explicit revoke (is_owner=false or is_admin=false via the same route) or '
  'direct DB access — never by the self-service view-as-admin toggle. Gates '
  'whether POST /profile/view-as-admin may restore is_owner=true.';

-- Backfill: current owners keep their heritage marker.
UPDATE profiles SET is_owner_was = true WHERE is_owner = true;
