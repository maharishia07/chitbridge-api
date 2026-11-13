/**
 * fin71-step-ticket.test.cjs — FIN-71 · A BILL'S R-1400 STEP THAT FAILS RAISES ONE SUPPORT TICKET, NEVER SILENT (plan: PM/FIN-71-PLAN.md v2).
 *
 * A payment posted, the books are right, but the "Paid ₹300 of ₹481.65" step of the bill could not be written. moneySteps still returns its array
 * and reports each failed bill through its optional trailing onFail; both doors (POST /payments, POST /payments/:id/confirm) pass one that calls
 * bill-privacy.raiseStepTicket — ONE Sev-3 ticket per failed bill, client_ref 'r1400:'+payment_id+':'+against_ref (the unique index dedupes).
 * Hand-computed figures: bill 48165 (₹481.65), payment 30000, open after 18165.
 *   T1 confirm door, the step write throws: money rows unchanged, 0 steps, 1 ticket; the replay (duplicate: true) raises nothing more
 *   T2 no failure: 1 step "Paid ₹300 of ₹481.65", 0 tickets; the replay keeps 1 step and 0 tickets
 *   T3 two failing bills in one payment: 2 tickets, distinct client_ref
 *   T4 raise answers raised:false (or throws): logged, nothing throws, the answer is the same
 *   T5 cross-shop: the ticket is the raiser's alone; no state_log write carries the payment id or the failure
 *   T6 the policy read fails: the ticket, not "no step"; a shop at level none: no step and no ticket
 *   T7 POST /payments with allocations, the same failure: one ticket
 *   T8 the shop's view of the ticket (subject and detail) holds no SQL or database text
 * No database: the books run over the in-memory store; raiseticket.raise, tax-copy.copyOf and policy.get are stand-ins.
 * Run: node tests/fin71-step-ticket.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
async function section(title, fn) {
  console.log('\n── ' + title + ' ──');
  try { await fn(); } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack || e)); }
}

const SHOP = '11111111-1111-4111-8111-111111111111', SELLER = '77777777-7777-4777-8777-777777777777';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' };
const authStub = Object.assign((req, res, next) => { req.identity = OWNER; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
let attempts = 0;
const call = (port, method, p, body, headers) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'fin71-' + ++attempts }, headers || {}) },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

/* ── the stand-ins: what the step write does, what the policy answers, what the desk's raise answers ── */
const DB_FAULT = 'insert or update on table "state_log" violates foreign key constraint "state_log_chit_id_fkey"';
const W = { failStep: false, policy: null, policyFails: false, raise: 'ok', steps: [], fanouts: [], tickets: [], seen: new Set(), logs: [] };
const reset = () => { Object.assign(W, { failStep: false, policy: null, policyFails: false, raise: 'ok', steps: [], fanouts: [], tickets: [], seen: new Set(), logs: [] }); };
const BILL_OF = {};
function installStandIns(X) {
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  TC.copyOf = async (id) => (BILL_OF[id] ? { chit_id: id, purpose: 'invoice', sender_entity_id: SELLER, business_json: { bill_no: 'KT-1', till: { id: 'till-1' } } } : null);
  require(path.join(H.API, 'lib', 'policy')).get = async () => { if (W.policyFails) throw Object.assign(new Error('connection terminated: SELECT policy_flags FROM identities'), { code: '57P01' }); return W.policy || {}; };
  require(path.join(H.API, 'lib', 'raiseticket')).raise = async (from, who, t) => {
    W.tickets.push({ from, who, t });
    if (W.raise === 'throws') throw new Error('desk is down');
    if (W.raise === 'refuse') return { raised: false, why: 'population boundary: x' };
    if (W.seen.has(t.client_ref)) return { raised: false, duplicate: true, why: 'already raised' };
    W.seen.add(t.client_ref);
    return { raised: true, chit_id: 'ticket-' + W.seen.size };
  };
  const log = require(path.join(H.API, 'lib', 'logger')), was = log.error;
  log.error = (msg, ctx) => { W.logs.push({ msg, ctx }); return was.call(log, msg, ctx); };
  const real = X.db.query;
  X.db.query = async (text, v) => {
    const s = String(text).replace(/\s+/g, ' ');
    if (/SELECT can_see_costs FROM identities/.test(s)) return { rows: [{ can_see_costs: true }] };
    if (/SELECT display_name FROM identities WHERE identity_id = \$1/.test(s)) return { rows: [{ display_name: 'Chola Auto Care' }] };
    if (/FROM party_item WHERE entity_id = \$1 AND against_ref = \$2/.test(s)) return { rows: [{ open_minor: 18165, bill_minor: 48165 }] }; /* hand-computed: 48165 − 30000 */
    if (/state_log_fanout|INSERT INTO state_log/.test(s)) {
      W.fanouts.push({ s, v });
      if (W.failStep) throw Object.assign(new Error(DB_FAULT), { code: '23503' });
      W.steps.push({ chit_id: v[0], detail: /state_log_fanout/.test(s) ? v[4] : v[5] });
      return { rows: [{ n: 2 }], rowCount: 1 };
    }
    return real(text, v);
  };
}

/** a supplier with bills (minor units) posted as purchase bills; each is a bill TO the shop for the stand-in copyOf */
let seq = 0;
async function shopOf(X, minors) {
  const n = ++seq, party = '44444444-4444-4444-8444-' + String(n).padStart(12, '0'), refs = [];
  X.T.parties.push({ owner: SHOP, party_id: party, party_no: 'P-71' + n, name: 'Seventy-one ' + n, supplier: true, credit_days: 30 });
  let i = 0;
  for (const minor of minors) {
    const ref = 'c7100000-0000-4000-8000-' + String(n * 100 + ++i).padStart(12, '0');
    BILL_OF[ref] = true;
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-20', currency: 'INR', party, source_chit_id: ref, source_ref: 'chit:71-' + n + '-' + i, by_rate: [{ rate: 0, taxable: minor / 100, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
    refs.push(ref);
  }
  return { party, refs, key: 'fin71-' + n };
}
const PAY = (s, extra) => Object.assign({ party_id: s.party, direction: 'out', currency: 'INR', mode: 'cash', received_at: '2026-10-05' }, extra);
const allocRows = (X, ref) => X.T.items.filter((i) => i.against_ref === ref && Number(i.amount_minor) === -30000).length;
const ageAll = (X) => X.T.items.forEach((i) => { i.created_at = new Date(Date.now() - 1000).toISOString(); }); /* the replay window reads the shop clock */

(async () => {
  console.log('\n══ FIN-71 · a failed bill step raises one ticket, never silent ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n\n  ✓ 0 passed · 0 checks\n'); process.exit(1); }
  const X = H.load({ auth: authStub });
  installStandIns(X);
  const express = require('express'), app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  const q = (m, p, b, h) => call(port, m, '/api/books' + p, b, h);
  await q('POST', '/enable', {});
  const BP = require(path.join(H.API, 'lib', 'bill-privacy'));

  await section('T1 · the confirm door: the step write throws → the books stand, 0 steps, 1 ticket; the replay raises nothing more', async () => {
    reset(); W.failStep = true;
    const s = await shopOf(X, [48165]), [bill] = s.refs;
    const rec = await q('POST', '/payments', PAY(s, { amount_minor: 30000, client_ref: s.key }));
    const pid = rec.body.payment.payment_id;
    ok('₹300 recorded on account first (no bill named, so no step yet)', rec.status === 200 && !rec.body.allocation && W.tickets.length === 0, JSON.stringify(rec.body));
    const body = { allocations: [{ against_ref: bill, amount_minor: 30000 }] };
    const first = await q('POST', '/payments/' + pid + '/confirm', body);
    ok('confirm answers 200 — the failed step never undoes the posting', first.status === 200 && first.body.ok === true && !first.body.duplicate, JSON.stringify(first.body));
    eq('money rows unchanged: exactly one allocation of −30000 against the bill', allocRows(X, bill), 1);
    eq('0 bill_step rows written', W.steps.length, 0);
    eq('1 ticket, Sev-3, client_ref r1400:<payment>:<bill>', [W.tickets.length, W.tickets[0] && W.tickets[0].t.severity, W.tickets[0] && W.tickets[0].t.client_ref], [1, 'Sev-3', 'r1400:' + pid + ':' + bill]);
    ageAll(X);
    const again = await q('POST', '/payments/' + pid + '/confirm', body);
    ok('the same confirm pressed again → duplicate: true, nothing settled twice', again.status === 200 && again.body.duplicate === true && allocRows(X, bill) === 1, JSON.stringify(again.body));
    eq('…still 1 ticket and 0 steps', [W.tickets.length, W.steps.length], [1, 0]);
  });

  await section('T2 · no failure: one step "Paid ₹300 of ₹481.65", no ticket; the replay writes nothing', async () => {
    reset();
    const s = await shopOf(X, [48165]), [bill] = s.refs;
    const rec = await q('POST', '/payments', PAY(s, { amount_minor: 30000, client_ref: s.key }));
    const pid = rec.body.payment.payment_id, body = { allocations: [{ against_ref: bill, amount_minor: 30000 }] };
    await q('POST', '/payments/' + pid + '/confirm', body);
    eq('1 step row, 0 tickets', [W.steps.length, W.tickets.length], [1, 0]);
    const step = JSON.parse((W.steps[0] || {}).detail || '{}');
    ok('it reads "Paid ₹300 of ₹481.65" (30000 of 48165, 18165 due, R-1400)', BP.label(step, true) === 'Paid ₹300 of ₹481.65' && step.of_minor === 48165 && step.due_minor === 18165 && step.code === 'R-1400', JSON.stringify(step));
    ok('NO payment id in the step (state_log_fanout would copy it to the other party)', !/payment_id|pay:/.test(W.steps[0].detail) && !W.steps[0].detail.includes(pid), W.steps[0].detail);
    eq('the step keeps its seven keys, no new one', Object.keys(step).sort(), ['amount_minor', 'code', 'currency', 'due_minor', 'label', 'of_minor', 'party', 'step'].sort());
    ageAll(X);
    const again = await q('POST', '/payments/' + pid + '/confirm', body);
    eq('replay → duplicate, still 1 step and 0 tickets', [again.body.duplicate, W.steps.length, W.tickets.length], [true, 1, 0]);
    const kept = await BP.moneySteps(SHOP, { direction: 'out', currency: 'INR' }, [{ against_ref: bill, amount_minor: 30000 }], { id: SHOP });
    ok('moneySteps still returns its array of written steps', Array.isArray(kept) && kept.length === 1 && kept[0].written === 'all', JSON.stringify(kept));
  });

  await section('T3 · two failing bills in one payment → two tickets, distinct client_ref', async () => {
    reset(); W.failStep = true;
    const s = await shopOf(X, [48165, 48165]);
    const rec = await q('POST', '/payments', PAY(s, { amount_minor: 60000, client_ref: s.key, allocations: s.refs.map((r) => ({ against_ref: r, amount_minor: 30000 })) }));
    const refs = W.tickets.map((t) => t.t.client_ref);
    ok('POST /payments answers 200 with both bills settled', rec.status === 200 && rec.body.allocation && rec.body.allocation.settled.length === 2, JSON.stringify(rec.body.allocation));
    eq('2 tickets, one per bill, distinct client_ref', [W.tickets.length, new Set(refs).size, refs.sort()], [2, 2, s.refs.map((r) => 'r1400:' + rec.body.payment.payment_id + ':' + r).sort()]);
  });

  await section('T4 · the raise answers raised:false or throws → logged, nothing throws, the answer is the same', async () => {
    reset(); W.failStep = true;
    const s1 = await shopOf(X, [48165]);
    const ref = await q('POST', '/payments', PAY(s1, { amount_minor: 30000, client_ref: s1.key, allocations: [{ against_ref: s1.refs[0], amount_minor: 30000 }] }));
    reset(); W.failStep = true; W.raise = 'refuse';
    const s2 = await shopOf(X, [48165]);
    const refused = await q('POST', '/payments', PAY(s2, { amount_minor: 30000, client_ref: s2.key, allocations: [{ against_ref: s2.refs[0], amount_minor: 30000 }] }));
    const shape = (r) => Object.keys(r.body).sort().concat(Object.keys(r.body.allocation || {}).sort());
    ok('raised:false → 200 and the same answer shape', refused.status === 200 && JSON.stringify(shape(refused)) === JSON.stringify(shape(ref)), JSON.stringify(shape(refused)));
    ok('…logged as money.step.raise-failed with its why', W.logs.some((l) => l.msg === 'money.step.raise-failed' && /population boundary/.test(String(l.ctx.why))), JSON.stringify(W.logs.map((l) => l.msg)));
    reset(); W.raise = 'throws';
    const out = await BP.raiseStepTicket(SHOP, { payment_id: 'p1' }, { against_ref: 'b1', err: new Error('x') });
    ok('a raise that throws → { raised: false }, logged, never thrown', out.raised === false && W.logs.some((l) => l.msg === 'money.step.raise-failed' && /desk is down/.test(l.ctx.err)), JSON.stringify(out));
    reset(); W.raise = 'ok';
    await BP.raiseStepTicket(SHOP, { payment_id: 'p1' }, { against_ref: 'b1', err: new Error('x') });
    const dup = await BP.raiseStepTicket(SHOP, { payment_id: 'p1' }, { against_ref: 'b1', err: new Error('x') });
    ok('a duplicate is answered as duplicate and is NOT logged as a failure', dup.duplicate === true && !W.logs.some((l) => l.msg === 'money.step.raise-failed'), JSON.stringify(dup));
  });

  await section('T5 · cross-shop: the ticket is the raiser\'s alone; no state_log write carries the payment or the failure', async () => {
    reset(); W.failStep = true;
    const s = await shopOf(X, [48165]);
    const rec = await q('POST', '/payments', PAY(s, { amount_minor: 30000, client_ref: s.key, allocations: [{ against_ref: s.refs[0], amount_minor: 30000 }] }));
    const pid = rec.body.payment.payment_id;
    eq('one ticket, raised AS the shop, to our platform desk, by the system actor', [W.tickets.length, W.tickets[0].from.entity_id, W.tickets[0].t.audience, W.tickets[0].who.name], [1, SHOP, 'platform', 'system']);
    const written = JSON.stringify(W.fanouts.map((f) => f.v));
    ok('no state_log (or fanout) write holds the payment id or the failure text — nothing reaches the other party', !written.includes(pid) && !/violates|23503/.test(written), written);
    eq('and no step row was written for the other party to receive', W.steps.length, 0);
  });

  await section('T6 · the policy read fails → the ticket; a shop at level none → no step, no ticket', async () => {
    reset(); W.policyFails = true;
    const s = await shopOf(X, [48165]);
    await q('POST', '/payments', PAY(s, { amount_minor: 30000, client_ref: s.key, allocations: [{ against_ref: s.refs[0], amount_minor: 30000 }] }));
    eq('policy read failed → 0 steps, 1 ticket (not a silent "no step")', [W.steps.length, W.tickets.length], [0, 1]);
    ok('…its detail names a database error, not the policy SQL', !/SELECT|policy_flags/.test(W.tickets[0].t.detail) && /database error/.test(W.tickets[0].t.detail), W.tickets[0].t.detail);
    reset(); W.policy = { system_folders: { 'R-1400': { msg: 'none' } } };
    const s2 = await shopOf(X, [48165]);
    await q('POST', '/payments', PAY(s2, { amount_minor: 30000, client_ref: s2.key, allocations: [{ against_ref: s2.refs[0], amount_minor: 30000 }] }));
    eq('level none is the policy\'s answer: 0 steps, 0 tickets', [W.steps.length, W.tickets.length], [0, 0]);
  });

  await section('T7 · POST /payments with allocations, the same failure → one ticket', async () => {
    reset(); W.failStep = true;
    const s = await shopOf(X, [48165]), [bill] = s.refs;
    const rec = await q('POST', '/payments', PAY(s, { amount_minor: 30000, client_ref: s.key, allocations: [{ against_ref: bill, amount_minor: 30000 }] }));
    const pid = rec.body.payment.payment_id;
    ok('200, the bill settled in the same call, one allocation of −30000', rec.status === 200 && allocRows(X, bill) === 1, JSON.stringify(rec.body.allocation));
    eq('one ticket with the payment+bill client_ref, 0 steps', [W.tickets.length, W.tickets[0].t.client_ref, W.steps.length], [1, 'r1400:' + pid + ':' + bill, 0]);
    const replay = await q('POST', '/payments', PAY(s, { amount_minor: 30000, client_ref: s.key, allocations: [{ against_ref: bill, amount_minor: 30000 }] }));
    eq('the replay (same client_ref) → duplicate payment, no second ticket', [replay.body.payment.duplicate, W.tickets.length], [true, 1]);
  });

  await section('T8 · the shop\'s view of the ticket: a plain sentence and the ids, no SQL or database text', async () => {
    reset(); W.failStep = true;
    const s = await shopOf(X, [48165]), [bill] = s.refs;
    const rec = await q('POST', '/payments', PAY(s, { amount_minor: 30000, client_ref: s.key, allocations: [{ against_ref: bill, amount_minor: 30000 }] }));
    const t = W.tickets[0].t, pid = rec.body.payment.payment_id;
    eq('subject = the fixed sentence + the payment and bill ids', t.subject, 'A payment was recorded but its history step is missing: payment ' + pid + ', bill ' + bill);
    const shown = t.subject + ' ' + t.detail;
    ok('neither subject nor detail carries SQL, a table, a constraint or the database words', !/SELECT|INSERT|state_log|violates|constraint|foreign key|fkey/i.test(shown), shown);
    ok('…the detail says the books are right and names the kind of fault with its code', /the books are right/.test(t.detail) && /a database error \(23503\)/.test(t.detail), t.detail);
    reset();
    await BP.raiseStepTicket(SHOP, { payment_id: 'p9' }, { against_ref: 'b9', err: new Error('the policy answered nothing in time') });
    ok('…and a plain error reads as itself, trimmed', /the policy answered nothing in time/.test(W.tickets[0].t.detail), W.tickets[0].t.detail);
  });

  srv.close();
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
