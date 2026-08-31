-- Разовый сброс тестовых данных: обнулить балансы всех пользователей и
-- очистить денежный журнал, не трогая выставленные услуги (listings).
-- FK-safe порядок удаления такой же, как в backend/smoke_test.js's
-- cleanupTestData() — сначала зависимые записи заказов, потом сами заказы.
begin;

-- Сообщения и переписки по заказам (conversations.type = 'order_chat')
delete from message_attachments where message_id in (
  select m.id from messages m
  join conversations c on c.id = m.conversation_id
  where c.type = 'order_chat'
);
delete from messages where conversation_id in (
  select id from conversations where type = 'order_chat'
);
delete from conversation_participants where conversation_id in (
  select id from conversations where type = 'order_chat'
);
delete from conversations where type = 'order_chat';

delete from order_attachments;
delete from disputes;
delete from reviews where order_id is not null;
delete from order_applications;
delete from orders;

-- Денежный журнал
delete from transactions;
delete from deposit_requests;
delete from withdrawal_requests;

-- Балансы
update profiles set balance = 0, deposited_balance = 0, earned_balance = 0;

commit;
