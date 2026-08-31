const supabase = require('../supabase_client');

// Stamps conversations.closed_at so the 180-day/1-year chat cleanup jobs
// know when the clock started. Never overwrites an existing value.
async function closeOrderConversation(orderId) {
  await supabase.from('conversations')
    .update({ closed_at: new Date().toISOString() })
    .eq('order_id', orderId).is('closed_at', null);
}

async function closeTicketConversation(ticketId) {
  await supabase.from('conversations')
    .update({ closed_at: new Date().toISOString() })
    .eq('support_ticket_id', ticketId).is('closed_at', null);
}

module.exports = { closeOrderConversation, closeTicketConversation };
