/**
 * Smoke test for СтудБиржа backend — balance-based order flow.
 * Covers: deposit cycle, order creation with instant deduction, auction refund_excess,
 *   awaiting_topup → topup, cancel open order, executor payout on completion, withdrawal,
 *   dispute resolve, support, ban.
 *
 * Prerequisites:
 *   - Backend running at BACKEND_URL (default http://localhost:3001)
 *   - .env with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   - .env with ADMIN_EMAIL, ADMIN_PASSWORD (existing admin account)
 *
 * Usage: node smoke_test.js  OR  npm run smoke-test
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const BASE         = process.env.BACKEND_URL ?? 'http://localhost:3001';
const SUPA_URL     = process.env.SUPABASE_URL;
const SUPA_ANON    = process.env.SUPABASE_ANON_KEY;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!SUPA_URL || !SUPA_ANON || !SUPA_SERVICE) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Missing ADMIN_EMAIL / ADMIN_PASSWORD in .env');
  process.exit(1);
}

const adminSupabase = createClient(SUPA_URL, SUPA_SERVICE, { auth: { persistSession: false } });
const anonSupabase  = createClient(SUPA_URL, SUPA_ANON,    { auth: { persistSession: false } });

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(n, msg) {
  console.log(`  ✅ [${n}] ${msg}`);
  passed++;
}

function fail(n, msg, detail) {
  console.log(`  ❌ [${n}] ${msg}${detail ? ` — ${detail}` : ''}`);
  failed++;
}

async function api(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

async function signIn(email, password) {
  const { data, error } = await anonSupabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session?.access_token) throw new Error(error?.message ?? 'Sign-in failed');
  return { token: data.session.access_token, userId: data.user.id };
}

async function createTestUser(prefix) {
  const ts    = Date.now();
  const email = `smoketest_${prefix}_${ts}@test.local`;
  const pass  = `Smoke_${ts}_Pass!`;
  const nick  = `smoke_${prefix}_${ts}`.slice(0, 30);

  const { data, error } = await adminSupabase.auth.admin.createUser({
    email, password: pass, email_confirm: true, user_metadata: { nickname: nick },
  });
  if (error) throw new Error(`createUser(${prefix}): ${error.message}`);

  await adminSupabase.from('profiles')
    .upsert({ id: data.user.id, nickname: nick }, { onConflict: 'id', ignoreDuplicates: false });

  return { email, pass, userId: data.user.id, nick };
}

async function setBalance(userId, amount) {
  await adminSupabase.from('profiles').update({ balance: amount }).eq('id', userId);
}

async function getBalance(userId) {
  const { data } = await adminSupabase.from('profiles').select('balance').eq('id', userId).single();
  return parseFloat(data?.balance ?? 0);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  СтудБиржа Smoke Test (balance-based)');
  console.log(`  Target: ${BASE}`);
  console.log('══════════════════════════════════════════\n');

  let adminToken, adminId;
  let custToken, custId;
  let execToken, execId;
  let cust2Token, cust2Id;
  let exec2Token, exec2Id;
  let orderId, appId;
  let ord2Id, app2Id;
  let ord3Id, app3Id;
  let depositId, withdrawalId;
  let disputeId;
  let ticketId;

  // ── Step 1: Health check ──────────────────────────────────────────────────
  console.log('Step 1 — Health check');
  try {
    const r = await api('GET', '/health', null, null);
    if (r.status === 200 && r.body.status === 'ok') ok(1, 'GET /health → 200 ok');
    else fail(1, 'GET /health', `status=${r.status} body=${JSON.stringify(r.body)}`);
  } catch (e) { fail(1, 'GET /health', e.message); }

  // ── Step 2: Create test users ─────────────────────────────────────────────
  console.log('\nStep 2 — Create test users');
  try {
    const cust  = await createTestUser('cust');
    const exec  = await createTestUser('exec');
    const cust2 = await createTestUser('cust2');
    const exec2 = await createTestUser('exec2');
    custId  = cust.userId;  execId  = exec.userId;
    cust2Id = cust2.userId; exec2Id = exec2.userId;
    ok(2, `Created cust=${cust.nick}, exec=${exec.nick}, cust2=${cust2.nick}, exec2=${exec2.nick}`);
  } catch (e) { fail(2, 'createTestUser', e.message); return summary(); }

  // ── Step 3: Sign in all users ─────────────────────────────────────────────
  console.log('\nStep 3 — Sign in');
  try {
    const adminCreds = await anonSupabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (!adminCreds.data?.session) throw new Error('admin sign-in failed');
    adminToken = adminCreds.data.session.access_token;
    adminId    = adminCreds.data.user.id;

    const c  = await anonSupabase.auth.signInWithPassword({ email: `smoketest_cust_${custId.split('').slice(-8).join('')}@test.local`, password: 'x' }).catch(() => ({}));
    // Use direct DB to get emails
    const { data: { user: custUser } } = await adminSupabase.auth.admin.getUserById(custId);
    const { data: { user: execUser } } = await adminSupabase.auth.admin.getUserById(execId);
    const { data: { user: cust2User } } = await adminSupabase.auth.admin.getUserById(cust2Id);
    const { data: { user: exec2User } } = await adminSupabase.auth.admin.getUserById(exec2Id);

    const r1 = await anonSupabase.auth.signInWithPassword({ email: custUser.email, password: custUser.email.replace('@test.local', '').replace('smoketest_cust_', 'Smoke_').replace('_Pass', '_Pass!') });
    // simpler: just sign-in via supabase admin updateUser then signIn
    // Actually let's just store pass during createTestUser — re-create with known pass

    ok(3, 'admin signed in');
    ok(3, `users created (sign-in tokens obtained via admin)`);

    // Get user tokens by re-creating sessions via admin API
    async function getTokenFor(userId) {
      // Use admin to generate a magic link / or just set a known password
      const email = (await adminSupabase.auth.admin.getUserById(userId)).data.user.email;
      const newPass = `SmokeFinal_123!`;
      await adminSupabase.auth.admin.updateUserById(userId, { password: newPass });
      const { data, error } = await anonSupabase.auth.signInWithPassword({ email, password: newPass });
      if (error) throw new Error(`sign-in ${email}: ${error.message}`);
      return data.session.access_token;
    }
    custToken  = await getTokenFor(custId);
    execToken  = await getTokenFor(execId);
    cust2Token = await getTokenFor(cust2Id);
    exec2Token = await getTokenFor(exec2Id);
    ok(3, 'All user tokens obtained');
  } catch (e) { fail(3, 'Sign-in', e.message); return summary(); }

  // ── Step 4: Deposit cycle ─────────────────────────────────────────────────
  console.log('\nStep 4 — Deposit cycle');
  try {
    // Customer requests deposit
    const r = await api('POST', '/wallet/deposits', custToken, { claimed_amount: 1000, payment_method: 'card' });
    if (r.status === 201 && r.body.id) {
      depositId = r.body.id;
      ok(4, `POST /wallet/deposits → 201, id=${depositId}`);
    } else {
      fail(4, 'POST /wallet/deposits', `status=${r.status} ${JSON.stringify(r.body)}`);
    }

    // Admin confirms deposit — credited 1:1, no commission (commission moved to withdrawal)
    const before = await getBalance(custId);
    const r2 = await api('POST', `/admin/deposits/${depositId}/confirm`, adminToken, { confirmed_amount: 1000 });
    if (r2.status === 200 && r2.body.credited_amount != null) {
      const after = await getBalance(custId);
      const credited = r2.body.credited_amount;
      const expected = 1000;
      if (Math.abs(credited - expected) < 0.01 && Math.abs(after - before - credited) < 0.01)
        ok(4, `Admin confirmed: credited=${credited} ₽ (=1000×1, no commission), balance ${before}→${after}`);
      else
        fail(4, 'Deposit credited_amount mismatch', `credited=${credited} expected=${expected} balance=${after}`);
    } else {
      fail(4, 'POST /admin/deposits/confirm', `status=${r2.status} ${JSON.stringify(r2.body)}`);
    }

    // Deposit transaction should carry no platform profit
    const { data: depTx } = await adminSupabase
      .from('transactions')
      .select('platform_profit')
      .eq('user_id', custId).eq('type', 'deposit')
      .order('created_at', { ascending: false }).limit(1).single();
    if (depTx && Math.abs(parseFloat(depTx.platform_profit ?? 0)) < 0.01)
      ok(4, `Deposit transaction platform_profit=0`);
    else
      fail(4, 'Deposit platform_profit should be 0', JSON.stringify(depTx));
  } catch (e) { fail(4, 'Deposit cycle', e.message); }

  // Top up balances directly for test reliability
  await setBalance(custId, 5000);
  await setBalance(execId, 500);
  await setBalance(cust2Id, 5000);
  await setBalance(exec2Id, 500);

  // ── Step 5: Create order — balance deducted immediately (no commission) ──────
  console.log('\nStep 5 — Create order (instant balance deduction, no commission)');
  try {
    const balBefore = await getBalance(custId);
    const r = await api('POST', '/orders', custToken, {
      title: 'Smoke курсовая', description: 'Тест балансовой оплаты. Удобное время: любое.', subject: 'Математика',
      order_type: 'order', base_amount: 500,
    });
    if (r.status === 201 && r.body.id) {
      orderId = r.body.id;
      const balAfter = await getBalance(custId);
      const deducted = Math.round((balBefore - balAfter) * 100) / 100;
      if (r.body.status === 'open' && Math.abs(deducted - 500) < 0.01)
        ok(5, `Order created id=${orderId.slice(0,8)}, status=open, deducted=${deducted} ₽ (= base_amount)`);
      else
        fail(5, 'Order status or deduction wrong', `status=${r.body.status} deducted=${deducted} expected=500`);
    } else {
      fail(5, 'POST /orders', `status=${r.status} ${JSON.stringify(r.body)}`);
    }
  } catch (e) { fail(5, 'Create order', e.message); }

  // ── Step 6: Insufficient balance check ───────────────────────────────────
  console.log('\nStep 6 — Reject order when balance insufficient');
  try {
    await setBalance(cust2Id, 10); // less than 500
    const r = await api('POST', '/orders', cust2Token, {
      title: 'Smoke нет денег', description: '...', subject: 'Физика',
      order_type: 'order', base_amount: 500,
    });
    if (r.status === 400 && r.body.error === 'insufficient_balance')
      ok(6, 'POST /orders → 400 insufficient_balance when balance < required');
    else
      fail(6, 'Expected 400 insufficient_balance', `status=${r.status} ${JSON.stringify(r.body)}`);
    await setBalance(cust2Id, 5000); // restore
  } catch (e) { fail(6, 'Insufficient balance', e.message); }

  // ── Step 7: Executor applies, customer selects → in_progress ─────────────
  console.log('\nStep 7 — Executor applies, customer selects (fixed_price)');
  try {
    const r1 = await api('POST', `/orders/${orderId}/apply`, execToken, { message: 'Готов выполнить', proposed_amount: 500 });
    if (r1.status === 201 && r1.body.id) {
      appId = r1.body.id;
      ok(7, `Executor applied, app id=${appId}`);
    } else {
      fail(7, 'POST /apply', `status=${r1.status} ${JSON.stringify(r1.body)}`); return summary();
    }

    const r2 = await api('POST', `/orders/${orderId}/applications/${appId}/select`, custToken, {});
    if (r2.status === 200 && r2.body.status === 'in_progress')
      ok(7, 'Customer selected executor → status=in_progress');
    else
      fail(7, 'Select executor', `status=${r2.status} ${JSON.stringify(r2.body)}`);
  } catch (e) { fail(7, 'Select executor', e.message); }

  // ── Step 8: Confirm completion → executor gets paid immediately ───────────
  console.log('\nStep 8 — Both parties confirm, executor gets payout immediately');
  try {
    const execBalBefore = await getBalance(execId);

    const r1 = await api('POST', `/orders/${orderId}/confirm`, execToken, {});
    if (r1.status === 200) ok(8, `Executor confirmed → status=${r1.body.status}`);
    else fail(8, 'Executor confirm', `status=${r1.status} ${JSON.stringify(r1.body)}`);

    const r2 = await api('POST', `/orders/${orderId}/confirm`, custToken, {});
    if (r2.status === 200 && r2.body.status === 'completed') {
      const execBalAfter = await getBalance(execId);
      const gained = Math.round((execBalAfter - execBalBefore) * 100) / 100;
      // Executor applied with proposed_amount=500 (same as base), no commission
      if (Math.abs(gained - 500) < 0.01)
        ok(8, `Order completed, executor balance +${gained} ₽`);
      else
        fail(8, 'Executor payout amount wrong', `gained=${gained} expected=500`);
    } else {
      fail(8, 'Customer confirm', `status=${r2.status} ${JSON.stringify(r2.body)}`);
    }
  } catch (e) { fail(8, 'Completion payout', e.message); }

  // ── Step 9: Cancel open order — full refund (no commission) ──────────────
  console.log('\nStep 9 — Cancel open order (full refund of reserved_amount)');
  try {
    await setBalance(custId, 5000);
    const r = await api('POST', '/orders', custToken, {
      title: 'Smoke отмена', description: '...', subject: 'Химия',
      order_type: 'order', base_amount: 400,
    });
    if (r.status !== 201) { fail(9, 'Create order for cancel', JSON.stringify(r.body)); return summary(); }
    const cancelOrderId = r.body.id;
    const balAfterCreate = await getBalance(custId);

    const rc = await api('POST', `/orders/${cancelOrderId}/cancel`, custToken, {});
    if (rc.status === 200 && rc.body.status === 'cancelled') {
      const balAfterCancel = await getBalance(custId);
      const refunded = Math.round((balAfterCancel - balAfterCreate) * 100) / 100;
      if (Math.abs(refunded - 400) < 0.01)
        ok(9, `Order cancelled, full refund=${refunded} ₽ (= reserved_amount)`);
      else
        fail(9, 'Refund amount wrong', `refunded=${refunded} expected=400`);
    } else {
      fail(9, 'Cancel order', `status=${rc.status} ${JSON.stringify(rc.body)}`);
    }
  } catch (e) { fail(9, 'Cancel order', e.message); }

  // ── Step 10: Executor bids lower → refund_excess ─────────────────────────
  console.log('\nStep 10 — Executor bids lower than budget → refund_excess');
  try {
    await setBalance(custId, 5000);
    const r = await api('POST', '/orders', custToken, {
      title: 'Smoke рефанд', description: '...', subject: 'История',
      order_type: 'order', base_amount: 1000,
    });
    if (r.status !== 201) { fail(10, 'Create order', JSON.stringify(r.body)); }
    else {
      ord2Id = r.body.id;
      const balAfterCreate = await getBalance(custId);

      const ra = await api('POST', `/orders/${ord2Id}/apply`, execToken, { message: 'Сделаю за 600', proposed_amount: 600 });
      if (ra.status !== 201) { fail(10, 'Apply', JSON.stringify(ra.body)); }
      else {
        app2Id = ra.body.id;
        const rs = await api('POST', `/orders/${ord2Id}/applications/${app2Id}/select`, custToken, {});
        if (rs.status === 200 && rs.body.status === 'in_progress') {
          const balAfterSelect = await getBalance(custId);
          const refundBack = Math.round((balAfterSelect - balAfterCreate) * 100) / 100;
          // reserved=1000, final=600 → excess=400
          if (Math.abs(refundBack - 400) < 0.01)
            ok(10, `refund_excess=${refundBack} ₽ credited (1000 - 600)`);
          else
            fail(10, 'refund_excess amount', `got=${refundBack} expected=400`);
        } else {
          fail(10, 'Select app', `status=${rs.status} ${JSON.stringify(rs.body)}`);
        }
      }
    }
  } catch (e) { fail(10, 'refund_excess flow', e.message); }

  // ── Step 11: Executor bids higher → awaiting_topup → topup ───────────────
  console.log('\nStep 11 — Executor bids higher than budget → awaiting_topup → topup');
  try {
    await setBalance(cust2Id, 5000);
    const r = await api('POST', '/orders', cust2Token, {
      title: 'Smoke доплата', description: '...', subject: 'Биология',
      order_type: 'order', base_amount: 500,
    });
    if (r.status !== 201) { fail(11, 'Create order for topup', JSON.stringify(r.body)); }
    else {
      ord3Id = r.body.id;

      const ra = await api('POST', `/orders/${ord3Id}/apply`, exec2Token, { message: 'Сделаю за 800', proposed_amount: 800 });
      if (ra.status !== 201) { fail(11, 'Apply for topup order', JSON.stringify(ra.body)); }
      else {
        app3Id = ra.body.id;
        const rs = await api('POST', `/orders/${ord3Id}/applications/${app3Id}/select`, cust2Token, {});
        if (rs.status === 200 && rs.body.status === 'awaiting_topup') {
          ok(11, `Select with higher price → awaiting_topup`);

          const balBeforeTopup = await getBalance(cust2Id);
          const rt = await api('POST', `/orders/${ord3Id}/topup`, cust2Token, {});
          if (rt.status === 200 && rt.body.status === 'in_progress') {
            const balAfterTopup = await getBalance(cust2Id);
            const paid = Math.round((balBeforeTopup - balAfterTopup) * 100) / 100;
            // reserved=500, final=800 → topup=300
            if (Math.abs(paid - 300) < 0.01)
              ok(11, `Topup paid=${paid} ₽ (800 - 500), order → in_progress`);
            else
              fail(11, 'Topup amount', `paid=${paid} expected=300`);
          } else {
            fail(11, 'POST /topup', `status=${rt.status} ${JSON.stringify(rt.body)}`);
          }
        } else {
          fail(11, 'Select with higher price', `status=${rs.status} ${JSON.stringify(rs.body)}`);
        }
      }
    }
  } catch (e) { fail(11, 'awaiting_topup flow', e.message); }

  // ── Step 12: Ledger visible to admin ─────────────────────────────────────
  console.log('\nStep 12 — GET /admin/ledger');
  try {
    const r = await api('GET', '/admin/ledger', adminToken, null);
    if (r.status === 200 && Array.isArray(r.body))
      ok(12, `GET /admin/ledger → 200, ${r.body.length} entries`);
    else
      fail(12, 'GET /admin/ledger', `status=${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
  } catch (e) { fail(12, 'Ledger', e.message); }

  // ── Step 13: Withdrawal cycle ─────────────────────────────────────────────
  console.log('\nStep 13 — Withdrawal cycle');
  try {
    await setBalance(execId, 1000);
    const balBefore = await getBalance(execId);

    const r = await api('POST', '/wallet/withdrawals', execToken, { amount: 300, card_number: '4111111111111111' });
    if (r.status === 201 && r.body.id) {
      withdrawalId = r.body.id;
      const balAfterReq = await getBalance(execId);
      const deducted = Math.round((balBefore - balAfterReq) * 100) / 100;
      if (Math.abs(deducted - 300) < 0.01)
        ok(13, `Withdrawal requested, balance deducted: ${deducted} ₽`);
      else
        fail(13, 'Balance deduction on withdrawal', `deducted=${deducted}`);

      // Admin confirms
      const rc = await api('POST', `/admin/withdrawals/${withdrawalId}/confirm`, adminToken, {});
      if (rc.status === 200)
        ok(13, 'Admin confirmed withdrawal');
      else
        fail(13, 'Admin confirm withdrawal', `status=${rc.status} ${JSON.stringify(rc.body)}`);

      // Withdrawal transaction should hold 10% commission in platform_profit (amount stays full)
      const { data: wTx } = await adminSupabase
        .from('transactions')
        .select('amount, platform_profit')
        .eq('user_id', execId).eq('type', 'withdrawal')
        .order('created_at', { ascending: false }).limit(1).single();
      const expectedProfit = Math.round(300 * 0.1 * 100) / 100;
      if (wTx && Math.abs(parseFloat(wTx.amount) - 300) < 0.01 && Math.abs(parseFloat(wTx.platform_profit ?? 0) - expectedProfit) < 0.01)
        ok(13, `Withdrawal transaction: amount=${wTx.amount} ₽, platform_profit=${wTx.platform_profit} ₽ (10%)`);
      else
        fail(13, 'Withdrawal commission mismatch', JSON.stringify(wTx));
    } else {
      fail(13, 'POST /wallet/withdrawals', `status=${r.status} ${JSON.stringify(r.body)}`);
    }
  } catch (e) { fail(13, 'Withdrawal cycle', e.message); }

  // ── Step 14: Withdrawal reject → balance restored ─────────────────────────
  console.log('\nStep 14 — Withdrawal reject → refund balance');
  try {
    await setBalance(execId, 1000);
    const balBefore = await getBalance(execId);
    const rw = await api('POST', '/wallet/withdrawals', execToken, { amount: 200, card_number: '4111111111111111' });
    if (rw.status !== 201) { fail(14, 'Create withdrawal for reject', JSON.stringify(rw.body)); }
    else {
      const wid = rw.body.id;
      const r = await api('POST', `/admin/withdrawals/${wid}/reject`, adminToken, { admin_comment: 'Тест отклонения' });
      if (r.status === 200) {
        const balAfter = await getBalance(execId);
        if (Math.abs(balAfter - balBefore) < 0.01)
          ok(14, `Withdrawal rejected, balance restored: ${balAfter} ₽`);
        else
          fail(14, 'Balance after rejection', `before=${balBefore} after=${balAfter}`);
      } else {
        fail(14, 'Admin reject withdrawal', `status=${r.status} ${JSON.stringify(r.body)}`);
      }
    }
  } catch (e) { fail(14, 'Withdrawal reject', e.message); }

  // ── Step 15: Dispute → resolve pay_executor ──────────────────────────────
  console.log('\nStep 15 — Dispute and resolve pay_executor');
  try {
    await setBalance(custId, 5000);
    const ro = await api('POST', '/orders', custToken, {
      title: 'Smoke спор', description: '...', subject: 'Право',
      order_type: 'order', base_amount: 300,
    });
    if (ro.status !== 201) { fail(15, 'Create order for dispute', JSON.stringify(ro.body)); }
    else {
      const dispOrderId = ro.body.id;
      const reserved = parseFloat(ro.body.reserved_amount);

      const ra = await api('POST', `/orders/${dispOrderId}/apply`, execToken, { message: 'Сделаю', proposed_amount: 300 });
      const rsel = await api('POST', `/orders/${dispOrderId}/applications/${ra.body.id}/select`, custToken, {});
      if (rsel.body.status !== 'in_progress') { fail(15, 'Setup dispute order', JSON.stringify(rsel.body)); }
      else {
        const rd = await api('POST', `/orders/${dispOrderId}/dispute`, custToken, { reason: 'Smoke тест спора' });
        if (rd.status === 200) {
          // List disputes
          const rl = await api('GET', '/admin/disputes', adminToken, null);
          const dispute = (rl.body ?? []).find(d => d.orders?.id === dispOrderId);
          if (dispute) {
            disputeId = dispute.id;
            const execBalBefore = await getBalance(execId);
            const rr = await api('POST', `/admin/disputes/${disputeId}/resolve`, adminToken, { resolution: 'pay_executor', admin_comment: 'Smoke: исполнитель прав' });
            if (rr.status === 200) {
              const execBalAfter = await getBalance(execId);
              const gained = Math.round((execBalAfter - execBalBefore) * 100) / 100;
              if (Math.abs(gained - 300) < 0.01)
                ok(15, `Dispute resolved pay_executor, executor +${gained} ₽`);
              else
                fail(15, 'Dispute pay_executor amount', `gained=${gained} expected=300`);
            } else {
              fail(15, 'Resolve dispute', `status=${rr.status} ${JSON.stringify(rr.body)}`);
            }
          } else {
            fail(15, 'Dispute not found in list', `order=${dispOrderId}`);
          }
        } else {
          fail(15, 'Open dispute', `status=${rd.status} ${JSON.stringify(rd.body)}`);
        }
      }
    }
  } catch (e) { fail(15, 'Dispute flow', e.message); }

  // ── Step 16: Support ticket ───────────────────────────────────────────────
  console.log('\nStep 16 — Support ticket');
  try {
    const r = await api('POST', '/support/tickets', custToken, { subject: 'Smoke тикет', message: 'Тестовое сообщение поддержки' });
    if (r.status === 201 && (r.body.id || r.body.ticket_id)) {
      ticketId = r.body.ticket_id ?? r.body.id;
      ok(16, `Ticket created id=${ticketId}`);

      const rc = await api('PATCH', `/admin/support/tickets/${ticketId}/close`, adminToken, {});
      if (rc.status === 200) ok(16, 'Ticket closed by admin');
      else fail(16, 'Close ticket', `status=${rc.status}`);
    } else {
      fail(16, 'Create ticket', `status=${r.status} ${JSON.stringify(r.body)}`);
    }
  } catch (e) { fail(16, 'Support ticket', e.message); }

  // ── Step 17: Ban / unban user ─────────────────────────────────────────────
  console.log('\nStep 17 — Ban and unban user');
  try {
    const rb = await api('PATCH', `/admin/users/${custId}`, adminToken, { is_banned: true });
    if (rb.status === 200) {
      // Banned user should get 403 from isBanned middleware
      const rord = await api('POST', '/orders', custToken, {
        title: 'Smoke бан', description: '...', subject: 'X', order_type: 'fixed_price', base_amount: 100,
      });
      if (rord.status === 403)
        ok(17, 'Banned user → 403 on protected route');
      else
        fail(17, 'Ban check', `expected 403 got ${rord.status}`);

      const ru = await api('PATCH', `/admin/users/${custId}`, adminToken, { is_banned: false });
      if (ru.status === 200) ok(17, 'User unbanned');
      else fail(17, 'Unban', `status=${ru.status}`);
    } else {
      fail(17, 'Ban user', `status=${rb.status}`);
    }
  } catch (e) { fail(17, 'Ban/unban', e.message); }

  summary();
}

function summary() {
  const total = passed + failed;
  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) console.log(`  ❌ ${failed} FAILED`);
  else console.log('  All tests passed ✅');
  console.log('══════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
