#!/usr/bin/env node
// @type: unit
/**
 * rail-155-use-replay.test.cjs — RAIL-155 (cb-rail): ASKING FOR THE USE A BILL ALREADY HAS, AFTER IT IS ACCEPTED, IS A REPLAY (ok, duplicate), NOT A 409.
 * lib/bill-use set() refused every ask on an accepted bill with 409 "already accepted"; a replay of goods-in failed on it. A DIFFERENT answer stays refused.
 * HAND-COMPUTED: an accepted bill I received, chosen use = resale (line L1 = asset).
 *   ask use resale            → ok, duplicate (same bill use)         ask lines {L1: asset}  → ok, duplicate (same line use)
 *   ask use asset             → 409 (a different answer)               ask lines {L1: use}    → 409
 *   ask a supplier (party)    → 409 (a write of its own, never a repeat)   a PENDING bill, ask resale → written (no duplicate flag), 1 UPDATE.   6 asks, 2 ok + 3 refused + 1 written.
 * RUN       node tests/rail-155-use-replay.test.cjs      (offline: set() takes its db and copy reader as deps)
 * CARD      12-suppliers-and-procurement/functions/purchase-order-and-goods-receipt.md
 */
'use strict';
const billUse = require('../lib/bill-use');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const ME = '11111111-1111-4111-8111-111111111111', CHIT = '33333333-3333-4333-8333-333333333333', L1 = '44444444-4444-4444-8444-444444444444';

const copyIn = (status) => ({ chit_id: CHIT, current_status: status, line_items: [{ line_id: L1, particulars: 'Brake pads' }], business_json: { use: { bill: 'resale', lines: { [L1]: 'asset' } } } });
function run(status, body) {
  const writes = [];
  const deps = { taxCopy: { copyOf: async () => copyIn(status), billReceived: () => true, capturedBill: () => false }, withEntity: async (e, fn) => fn({ query: async (sql) => { writes.push(sql); return { rows: [] }; } }) };
  return billUse.set(ME, CHIT, body, { name: 'Mala' }, deps).then((r) => ({ r, writes }));
}

(async () => {
  console.log('\n== RAIL-155 · the same use, asked again on an accepted bill ==');
  let o = await run('accepted', { use: 'resale' });
  t('same bill use: ok + duplicate, nothing written', o.r.ok === true && o.r.duplicate === true && o.writes.length === 0, JSON.stringify(o.r));
  t('the answer carries the stored choice', o.r.use && o.r.use.bill === 'resale' && o.r.use.lines[L1] === 'asset');
  o = await run('accepted', { lines: { [L1]: 'asset' } });
  t('same line use: ok + duplicate', o.r.ok === true && o.r.duplicate === true, JSON.stringify(o.r));
  o = await run('accepted', { use: 'asset' });
  t('a different bill use: 409', o.r.ok === false && o.r.status === 409, JSON.stringify(o.r));
  o = await run('accepted', { lines: { [L1]: 'use' } });
  t('a different line use: 409', o.r.ok === false && o.r.status === 409, JSON.stringify(o.r));
  o = await run('accepted', { party: { name: 'Acme' } });
  t('a supplier link on an accepted bill: 409', o.r.ok === false && o.r.status === 409, JSON.stringify(o.r));
  o = await run('pending', { use: 'resale' });
  t('a pending bill still writes (no duplicate flag)', o.r.ok === true && !o.r.duplicate && o.writes.length === 1, JSON.stringify(o.r) + ' writes ' + o.writes.length);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
