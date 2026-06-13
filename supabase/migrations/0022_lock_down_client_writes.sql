-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY: lock down direct client writes.
--
-- All mutations in this app go through the backend (service_role key, which
-- bypasses RLS and column grants). The frontend only performs SELECTs via the
-- anon/authenticated roles. The default Supabase grants, however, let an
-- authenticated user write directly to PostgREST.
--
-- Critical example this closes: the orders INSERT policy only checks
-- customer_id = auth.uid() and column grants allow setting reserved_amount /
-- status / final_amount. A user could insert an "open" order with an arbitrary
-- reserved_amount WITHOUT the backend ever debiting their balance, then have an
-- accomplice fulfil it and receive a real, unfunded payout on completion.
--
-- Fix: revoke INSERT/UPDATE/DELETE from anon & authenticated on every table the
-- backend owns. SELECT is preserved (frontend reads + Realtime still work).
-- profiles is intentionally left as-is: its UPDATE grant is already restricted
-- to (avatar_url, nickname) at the column level — balance/is_admin/is_banned are
-- not client-writable — and profile rows are created by the SECURITY DEFINER
-- handle_new_user() trigger, not by the authenticated role.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE INSERT, UPDATE, DELETE ON
  orders,
  order_applications,
  order_attachments,
  listings,
  messages,
  message_attachments,
  conversations,
  conversation_participants,
  transactions,
  deposit_requests,
  withdrawal_requests,
  disputes,
  reviews,
  support_tickets
FROM anon, authenticated;

-- profiles: anon never writes; authenticated keeps only the column-level
-- UPDATE(avatar_url, nickname) granted in earlier migrations. INSERT is handled
-- by the SECURITY DEFINER handle_new_user() trigger.
REVOKE INSERT, UPDATE, DELETE ON profiles FROM anon;
REVOKE INSERT, DELETE         ON profiles FROM authenticated;
