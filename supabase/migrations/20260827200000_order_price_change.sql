-- ⚠️ См. CLAUDE.md "Migration history" — 0011-0036 не отражают реальную
-- историю миграций этого проекта. Эта миграция timestamp-версионная и
-- применяется напрямую через `supabase db query --linked -f <file>`.
--
-- Изменение цены уже подтверждённого заказа по согласию обеих сторон
-- (исполнитель предлагает новую цену в чате заказа, вторая сторона
-- принимает/отклоняет). Одно текущее предложение хранится прямо на заказе —
-- отдельная таблица истории не нужна, при принятии/отклонении поля просто
-- сбрасываются.
alter table orders
  add column pending_amount numeric,
  add column pending_amount_proposed_by uuid references profiles(id),
  add column pending_amount_proposed_at timestamptz;
