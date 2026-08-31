-- Support для авто-очистки чатов (сообщения-файлы >180 дней, сам чат >1 год
-- после закрытия) — нужна дата закрытия, которой раньше не было.
BEGIN;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Backfill: уже завершённые/отменённые заказы и закрытые тикеты считаем
-- закрытыми с момента их последнего изменения — точной даты закрытия чата
-- отдельно никто не хранил.
UPDATE conversations c
SET closed_at = o.updated_at
FROM orders o
WHERE c.order_id = o.id
  AND o.status IN ('completed', 'cancelled')
  AND c.closed_at IS NULL;

UPDATE conversations c
SET closed_at = COALESCE(
  (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id),
  c.created_at
)
FROM support_tickets t
WHERE c.support_ticket_id = t.id
  AND t.status = 'closed'
  AND c.closed_at IS NULL;

COMMIT;
