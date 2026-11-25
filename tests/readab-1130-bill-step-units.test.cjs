'use strict';
/**
 * tests/readab-1130-bill-step-units.test.cjs — the unit evidence (DISCIPLINES §7: one test per rule, a refusal path, fail closed) for lib/chit-bill-step.js.
 * No database, no network: the history writer and the desk raiser are stand-ins that answer or fail.
 *
 * HAND-COMPUTED (each expectation is the rule's own sentence):
 *   a step that writes at once answers 'written' after 1 write and raises nothing · one that fails once answers 'retried' after 2 writes and raises nothing ·
 *   one that fails twice is HELD for the owner: 'held', 2 writes, exactly 1 ticket (audience 'here', client_ref billstep:<chit>:<step>), the status change is never undone by it ·
 *   a held row that the desk REFUSES (a raise that throws) answers 'lost' (said in the log, never thrown) · a raise answered with neither raised nor duplicate is 'lost' · a duplicate (already raised) is 'held'.
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 * Run: node tests/readab-1130-bill-step-units.test.cjs
 * CARD 01-rail-core-the-chit/chit-move
 */
const assert = require('assert');
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const step = require(path.join(__dirname, '..', 'lib', 'chit-bill-step'));
const STEP = { code: 'B-2100', step: 'completed', label: 'Completed' };
const BY = { id: 'u', name: 'U' };
let checks = 0, failed = 0;
async function check(name, fn) {
  checks++;
  try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ': ' + e.message); }
}
/** a run with a writer that fails its first `failures` calls and a raiser that answers `raiseAnswer` or throws */
async function run(failures, raiseAnswer) {
  let writes = 0; const tickets = [];
  const out = await step.writeBillStep('e1', 'c1c1c1c1-0000', STEP, BY, {
    writeStep: async () => { writes += 1; if (writes <= failures) throw new Error('pool error'); },
    raise: async (ticket) => { if (raiseAnswer === 'throw') throw new Error('desk down'); tickets.push(ticket); return raiseAnswer; }
  });
  return { out, writes, tickets };
}
(async () => {
  await check('unit: a step that writes at once is written, one write, nothing raised', async () => {
    const r = await run(0, { raised: true });
    assert.deepStrictEqual([r.out, r.writes, r.tickets.length], ['written', 1, 0]);
  });
  await check('unit: the first write fails, the second writes: retried, two writes, nothing raised', async () => {
    const r = await run(1, { raised: true });
    assert.deepStrictEqual([r.out, r.writes, r.tickets.length], ['retried', 2, 0]);
  });
  await check('refusal path: both writes fail: held for the owner, one ticket on the owner\'s own desk keyed by chit and step', async () => {
    const r = await run(2, { raised: true });
    assert.deepStrictEqual([r.out, r.writes, r.tickets.length, r.tickets[0].audience, r.tickets[0].client_ref, r.tickets[0].severity], ['held', 2, 1, 'here', 'billstep:c1c1c1c1-0000:completed', 'Sev-3']);
  });
  await check('unit: a ticket that already exists (duplicate) still counts as held', async () => {
    const r = await run(2, { duplicate: true });
    assert.strictEqual(r.out, 'held');
  });
  await check('fail closed: both writes fail and the desk throws: lost, never thrown', async () => {
    const r = await run(2, 'throw');
    assert.deepStrictEqual([r.out, r.writes], ['lost', 2]);
  });
  await check('fail closed: the desk answers with neither raised nor duplicate: lost, not held', async () => {
    const r = await run(2, { raised: false });
    assert.strictEqual(r.out, 'lost');
  });
  await check('unit: the incident says the status stands and names the step', async () => {
    const r = await run(2, { raised: true });
    assert.ok(/completed/.test(r.tickets[0].subject) && /stands/.test(r.tickets[0].detail));
  });
  console.log('\n  ' + (checks - failed) + ' passed, ' + failed + ' failed · ' + checks + ' checks');
  process.exit(failed ? 1 : 0);
})();
