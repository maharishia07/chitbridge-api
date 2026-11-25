/**
 * tests/stock-below-zero.test.cjs — lib/stock-below-zero.js refusal(): a movement that asks to be refused below zero is refused in words, before any write (AT-F-03).
 * OWNS      the proof of each rule of the one refusal: no flag means no refusal (the till may go below zero on purpose), a flag that stays at or above zero is not refused, a flag that goes below
 *           zero is refused with the on-hand count, the unit and the asked count in words, a resend of a movement already in the log is never refused (duplicate), the log is read only on the
 *           refusal path, and a log that cannot be read refuses closed (the error is thrown, the movement is not let through).
 * CALLED BY scripts/guards.cjs · CI. No database: db.query is a recorder.
 * FLOW      refusal(db, entityId, movement, before, after, lotKeyed) → null | { ok: false, why }
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 * MIN unit-per-rule · MIN refusal-path · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const { refusal } = require('../lib/stock-below-zero');
const db = (rows, boom) => { const calls = []; return { calls, query: async (sql, params) => { calls.push([sql, params]); if (boom) throw boom; return { rows }; } }; };
let checks = 0;
const ok = (name, got, want) => { assert.deepStrictEqual(got, want, name); checks++; console.log('   ok   ' + name); };
(async () => {
  const asks = { ref: 'R1', line_ref: 'L1', reason: 'used', qty: -5, refuse_below_zero: true };
  let d = db([]);
  ok('a movement without the flag is never refused, even below zero, and the log is not read', [await refusal(d, 'e1', { ref: 'R1', qty: -5 }, { qty: 2 }, { qty: -3 }, ''), d.calls.length], [null, 0]);
  d = db([]);
  ok('a flagged movement that stays at zero or above is not refused, and the log is not read', [await refusal(d, 'e1', asks, { qty: 5 }, { qty: 0 }, ''), d.calls.length], [null, 0]);
  d = db([]);
  const refused = await refusal(d, 'e1', asks, { qty: 2, unit: 'kg' }, { qty: -3 }, '');
  ok('a flagged movement that goes below zero is refused in words: what is on hand, the unit, what was asked, and what to do', [refused.ok, refused.why], [false, 'only 2 kg on hand, so 5 cannot be recorded as used. Count the stock, or record the purchase first.']);
  d = db([]);
  ok('a unit-less balance is worded without a stray space', (await refusal(d, 'e1', asks, { qty: 0 }, { qty: -5 }, '')).why.startsWith('only 0 on hand, so 5 cannot'), true);
  d = db([{ '?column?': 1 }]);
  ok('duplicate: a resend of a movement already in the log (same ref, line, reason, lot) is not refused', [await refusal(d, 'e1', asks, { qty: 2 }, { qty: -3 }, 'LOT-A'), d.calls[0][1]], [null, ['e1', 'R1', 'L1', 'used', 'LOT-A']]);
  d = db([]);
  await refusal(d, 'e1', { qty: -5, reason: 'used', refuse_below_zero: true }, { qty: 2 }, { qty: -3 }, '');
  ok('a movement with no ref cannot be a resend: it is refused without reading the log', d.calls.length, 0);
  d = db([], Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }));
  let thrown = null;
  try { await refusal(d, 'e1', asks, { qty: 2 }, { qty: -3 }, ''); } catch (failure) { thrown = failure.code; }
  ok('fail closed: a log that cannot be read throws, so the movement is not let through as if it were a resend', thrown, 'ECONNRESET');
  console.log('\n' + checks + ' checks');
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });
