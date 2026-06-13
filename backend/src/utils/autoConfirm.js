const supabase = require('../supabase_client');
const { runAIChatCheck } = require('./aiChatCheck');

/**
 * Lazy auto-confirm: if an order is in awaiting_confirmation and its deadline has passed,
 * complete it automatically and create a payout transaction.
 * Returns true if the order was auto-confirmed, false otherwise.
 */
async function checkAndAutoConfirm(order) {
  if (order.status !== 'awaiting_confirmation') return false;
  if (!order.confirmation_deadline) return false;
  if (new Date() <= new Date(order.confirmation_deadline)) return false;

  const payoutAmount = Math.round(parseFloat(order.final_amount ?? order.base_amount) * 100) / 100;

  // Update only if still awaiting_confirmation (prevents double-processing on concurrent requests)
  const { data: updated } = await supabase
    .from('orders')
    .update({
      confirmed_by_customer: true,
      confirmed_by_executor: true,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('status', 'awaiting_confirmation')
    .select('id')
    .maybeSingle();

  if (!updated) return false; // Already changed by another request

  await supabase.rpc('add_wallet_balance', { p_user_id: order.executor_id, p_amount: payoutAmount });

  await supabase.from('transactions').insert({
    user_id: order.executor_id,
    order_id: order.id,
    type: 'order_payout',
    amount: payoutAmount,
    status: 'completed',
  });

  // Fire-and-forget AI chat check after auto-completion
  runAIChatCheck(order.id).catch(() => {});

  return true;
}

module.exports = { checkAndAutoConfirm };
