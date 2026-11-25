#!/usr/bin/env node
// @type: unit
/**
 * delivery-closed.test.cjs — lib/delivery-closed refuseWithdrawn (BA-F-05): goods are not recorded on an order that is rejected or cancelled, whichever side withdrew it.
 * OWNS      my own copy rejected/cancelled refuses; the OTHER party rejecting (the buyer's sent copy still says pending) refuses; one of two receivers rejecting does not; accepted passes;
 *           a failed read throws (fail closed: never "fine")
 * CALLED BY CI (T1). No database: a scripted handle.
 * FLOW      scripted chit_status + chit_participants rows -> refuseWithdrawn -> the thrown refusal or nothing
 * CARD      01-rail-core-the-chit/line-model
 */
'use strict';
const path = require('path');
const assert = require('assert');
const { refuseWithdrawn } = require(path.join(__dirname, '..', 'lib', 'delivery-closed.js'));
const refusal = (status, body) => Object.assign(new Error(body.message), { status, body });
const handle = (mine, others, fail) => ({
  query: async (sql) => {
    if (fail) throw new Error('read failed');
    if (/chit_participants/.test(sql)) return { rows: [{ entity_id: 'me', current_status: mine[0] }].concat(others.map((status, index) => ({ entity_id: 'o' + index, current_status: status }))) };
    return { rows: mine.map((status) => ({ current_status: status })) };
  }
});
const run = async (mine, others, fail) => {
  try {
    await refuseWithdrawn(handle(mine, others, fail), 'me', 'c1', refusal);
    return null;
  } catch (e) {
    return e;
  }
};
let passed = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, name + ' ' + JSON.stringify(detail));
  passed++;
  console.log('  ok  ' + name);
};
(async () => {
  let e = await run(['rejected'], ['pending']);
  ok('my own copy rejected: 409 wrong_step in words', e && e.status === 409 && e.body.why === 'wrong_step' && /rejected/.test(e.message), e);
  e = await run(['pending'], ['rejected']);
  ok('the other party rejected while mine still says pending: 409 wrong_step', e && e.status === 409 && e.body.why === 'wrong_step' && e.body.from === 'rejected', e);
  e = await run(['pending'], ['cancelled']);
  ok('the other party cancelled: 409', e && e.status === 409, e);
  e = await run(['pending'], ['rejected', 'accepted']);
  ok('one of two receivers rejected, the other accepted: no refusal', e === null, e);
  e = await run(['pending'], ['rejected', 'cancelled']);
  ok('every other party withdrew: refused', e && e.status === 409, e);
  e = await run(['accepted'], ['accepted']);
  ok('accepted both sides: no refusal', e === null, e);
  e = await run(['completed'], ['completed']);
  ok('a completed order still takes a correction: no refusal', e === null, e);
  e = await run(['pending'], []);
  ok('no other party (a self chit): no refusal', e === null, e);
  e = await run(['pending'], ['rejected'], true);
  ok('a failed read throws, never "fine"', e && /read failed/.test(e.message) && !e.status, e);
  console.log(passed + ' ok');
})().catch((err) => {
  console.log('  FAIL ' + (err && err.message));
  process.exit(1);
});
