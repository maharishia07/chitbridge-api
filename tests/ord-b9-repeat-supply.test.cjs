/**
 * ord-b9-repeat-supply.test.cjs — B9 (C9 repeat supply): ORD-90 a withdrawn agreement chit ends the agreement, no run sent · ORD-89 only an
 * all-zero counter is refused (counter, agree, run); one line at 0 is valid · ORD-93 a start that passed between counter and agree is refused
 * in words, never clamped (a catch-up of 12 runs in one call is the evidence) · ORD-88 one bill, one live agreement: a second send answers
 * the first row; a purpose that is no invoice and a unit that is a list are refused. Stand-in table and send path (no database).
 * Run: node tests/ord-b9-repeat-supply.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
const { memory } = require('./support/repeat-supply-memory.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const ACTOR = { id: 'a1' };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

(async () => {
  H.load({});
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock'));
  const R = require(path.join(H.API, 'lib', 'repeat-supply'));
  const mem = memory(); mem.migrated = true; R.use(mem.store); R.useSender(mem.sendAs);
  R.useMover(async (entity, chit_id, status) => ({ code: 200, moved: true, body: { chit_id, status } }));
  CLOCK.set('2026-10-05T06:00:00Z');
  const LINES = [{ line_id: 'L1', seq: 10, particulars: 'Milk', quantity: 20, price: 50, total: 1000 }, { line_id: 'L2', seq: 20, particulars: 'Curd', quantity: 5, price: 40, total: 200 }];
  let n = 0;
  const bill = (x) => { const id = 'bbbbbbbb-0000-4000-8000-' + String(++n).padStart(12, '0'); mem.hold(id, SHOP, CUST, Object.assign({ purpose: 'invoice', line_items: LINES, summary_json: { currency_code: 'INR', money: { total: 1200 } } }, x || {})); return id; };
  const make = async (b, extra) => R.create(SHOP, ACTOR, Object.assign({ chit_id: b, unit: 'daily', every: 1, start_on: '2026-10-06' }, extra || {}));
  const agreed = async (b, extra) => { const a = await make(b, extra); await R.accept(CUST, a.agreement_id, a.chit_id, ACTOR, null); return a; };
  const rowOf = (a) => mem.rows.find((r) => r.agreement_id === a.agreement_id);

  /* ORD-88 */
  const b1 = bill();
  const a1 = await make(b1);
  const a1b = await make(b1);
  ok('ORD-88: a second send for the same bill answers the first agreement, one chit, one row', a1b.agreement_id === a1.agreement_id && mem.sent.length === 1 && mem.rows.length === 1, JSON.stringify([mem.sent.length, mem.rows.length]));
  ok('ORD-88: the ref comes from the source bill', mem.sent[0].body.client_ref === 'rep:' + b1 + ':1');
  await R.decline(CUST, a1.agreement_id, a1.chit_id, ACTOR, {}, null);
  const a1c = await make(b1);
  ok('ORD-88: after a decline the same bill may be repeated again (ref :2)', a1c.agreement_id !== a1.agreement_id && mem.sent[mem.sent.length - 1].body.client_ref === 'rep:' + b1 + ':2');
  const eOrder = await fails(() => make(bill({ purpose: 'order' })));
  ok('ORD-88: a purpose that is no invoice is refused in words', eOrder && eOrder.status === 422 && /billed invoice/.test(eOrder.message), eOrder && eOrder.message);
  const eUnit = await fails(() => make(bill(), { unit: ['daily'] }));
  ok('ORD-88: a unit sent as a list is asked about, not read as "daily"', eUnit && eUnit.status === 400, eUnit && eUnit.message);

  /* ORD-89 */
  const a2 = await agreed(bill());
  const eZero = await fails(() => R.counter(CUST, a2.agreement_id, a2.chit_id, ACTOR, { lines: [{ line_id: 'L1', quantity: 0 }, { line_id: 'L2', quantity: 0 }] }));
  ok('ORD-89: a counter with every line at 0 is refused (400, decline instead)', eZero && eZero.status === 400 && /decline/.test(eZero.message), eZero && eZero.message);
  const c2 = await R.counter(CUST, a2.agreement_id, a2.chit_id, ACTOR, { lines: [{ line_id: 'L1', quantity: 0 }, { line_id: 'L2', quantity: 5 }] });
  ok('ORD-89: one line at 0 is a valid counter', c2.state === 'countered');
  const a3 = await agreed(bill());
  await R.counter(CUST, a3.agreement_id, a3.chit_id, ACTOR, { lines: [{ line_id: 'L1', quantity: 1 }] });
  rowOf(a3).counter.lines = [{ line_id: 'L1', quantity: 0 }, { line_id: 'L2', quantity: 0 }];
  const eAgree = await fails(() => R.agree(SHOP, a3.agreement_id, ACTOR));
  ok('ORD-89: a stored all-zero counter cannot be agreed', eAgree && eAgree.status === 422 && /decline/.test(eAgree.message), eAgree && eAgree.message);
  const a4 = await agreed(bill());
  rowOf(a4).terms = { lines: [{ line_id: 'L1', quantity: 0 }, { line_id: 'L2', quantity: 0 }] };
  const before = mem.sent.length;
  const s4 = await R.sweep(SHOP, '2026-10-06');
  ok('ORD-89: runOne with no line left sends nothing, ends the agreement naming the cause, records the problem',
    mem.sent.length === before && rowOf(a4).state === 'ended' && /Every line is at 0/.test(rowOf(a4).state_note) && s4.problems.some((p) => p.agreement_id === a4.agreement_id), JSON.stringify([rowOf(a4).state, rowOf(a4).state_note, s4.problems]));
  ok('ORD-89: the next sweep does not retry it', (await R.sweep(SHOP, '2026-10-07')).problems.every((p) => p.agreement_id !== a4.agreement_id));

  /* ORD-90 */
  const a5 = await agreed(bill());
  mem.chits[a5.chit_id + '|' + SHOP].current_status = 'cancelled';
  const before5 = mem.sent.length;
  const s5 = await R.sweep(SHOP, '2026-10-06');
  ok('ORD-90: a cancelled agreement chit ends the agreement, names the cause, sends no run',
    mem.sent.length === before5 && rowOf(a5).state === 'ended' && /cancelled/.test(rowOf(a5).state_note) && s5.problems.some((p) => /cancelled/.test(p.why)), JSON.stringify([rowOf(a5).state, rowOf(a5).state_note, s5.problems]));

  /* ORD-93 */
  const a6 = await agreed(bill());
  const eStart = await fails(() => R.counter(CUST, a6.agreement_id, a6.chit_id, ACTOR, { start_on: '2026-10-01' }));
  ok('ORD-93: a counter naming a start before the seller\'s day is refused at counter()', eStart && eStart.status === 400 && /past/.test(eStart.message), eStart && eStart.message);
  await R.counter(CUST, a6.agreement_id, a6.chit_id, ACTOR, { start_on: '2026-10-08' });
  CLOCK.set('2026-10-11T06:00:00Z'); /* five days pass before the seller looks */
  const eLate = await fails(() => R.agree(SHOP, a6.agreement_id, ACTOR));
  ok('ORD-93: agree() after the start passed is refused in words; next_on is not clamped, no catch-up is armed',
    eLate && eLate.status === 422 && /start day has passed/.test(eLate.message) && rowOf(a6).state === 'countered' && rowOf(a6).next_on !== '2026-10-11', eLate && eLate.message);
  const a7 = await agreed(bill(), { start_on: '2026-10-11' });
  await R.counter(CUST, a7.agreement_id, a7.chit_id, ACTOR, { every: 2 });
  const ok7 = await fails(() => R.agree(SHOP, a7.agreement_id, ACTOR));
  ok('ORD-93: a counter that only changes "every" (the start is the row\'s own) is still agreeable', ok7 === null, ok7 && ok7.message);

  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
