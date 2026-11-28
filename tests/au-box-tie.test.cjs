/**
 * tests/au-box-tie.test.cjs — BAS box = its drill (batch 1138 hold, 28 Nov 2026): for EVERY AU box the ledgers behind it add to the box (split_ok true), on a same-period return, a bad debt and a shop with no adjustment.
 * OWNS      the tie guard of the walk finding "1B 72.50 against a drill of 15.00" (a return's GST read at 1B while the 1B drill listed only gst_paid) and the hand figures of the same-quarter return
 * CALLED BY scripts/guards.cjs · CI. No database: the rows are the period's movements (what movementsBetween hands the engine); the handle used by splitAdjustments throws if it is ever asked.
 * FLOW      rows → splitAdjustments (the shipped pack: held, no query) → the engine's returnFor → boxesOf → splitBoxes → every box's split_ok + the drill sums
 * CARD      14-accounting/README
 * ⭐ A mismatch is reported, never recomputed: the sums compared are two CARRIED totals (the box, and its ledgers' sum). MUTATION: with the held adjustment rules switched ON (the pack's members) and the box roles unchanged, the 1B tie goes red.
 * MIN unit-per-rule · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const AU = require('../lib/reg-au'), Adj = require('../lib/reg-au-adjust');
const Taxed = require('../lib/books-period-taxed'), Split = require('../lib/books-return-split'), Period = require('../lib/books-period'), GR = require('../lib/gst-returns');
let checks = 0;
const ok = (name, cond, why) => { assert.ok(cond, name + (why ? ' · ' + why : '')); checks++; console.log('   ok   ' + name); };
const noQuery = { query: async () => { throw new Error('the shipped AU pack must not ask the books for adjustments'); } };
const codeOf = (role) => String(AU.ledgers.find((a) => a.role === role).code); /* the pack's own ledger for a role, never a typed code */
const rows = (list) => list.map(([, role, dr, cr]) => ({ code: codeOf(role), role, dr_minor: dr, cr_minor: cr }));
const FIX = {
  /* sale 110.00 incl GST (sales 100.00, GST 10.00) and a same-quarter return 11.00 incl GST (10.00 + GST 1.00): G1 99.00 · 1A 9.00 · 1B 0 · 9 = 9.00 */
  'same-period return': { rows: rows([['4000', 'sales', 0, 10000], ['2200', 'gst_collected', 0, 1000], ['4090', 'sales_returns', 1000, 0], ['2200', 'gst_collected', 100, 0]]), want: { G1: 9900, '1A': 900, '1B': 0, 9: 900 } },
  /* a bad debt of 99.00 posts whole to bad debts (no GST line while the Division 21 source is unread): G1, 1A, 1B untouched by it */
  'bad debt': { rows: rows([['4000', 'sales', 0, 10000], ['2200', 'gst_collected', 0, 1000], ['6850', 'bad_debts', 9900, 0]]), want: { G1: 11000, '1A': 1000, '1B': 0, 9: 1000 } },
  'no adjustment': { rows: rows([['4000', 'sales', 0, 20000], ['2200', 'gst_collected', 0, 2000], ['6010', 'purchases', 5000, 0], ['2210', 'gst_paid', 500, 0]]), want: { G1: 22000, '1A': 2000, '1B': 500, 9: 1500 } }
};
const run = async (pack, fixRows, opts) => {
  const ledger = fixRows.map((r) => Object.assign({}, r));
  await Taxed.splitAdjustments(opts && opts.handle ? opts.handle : noQuery, 'E1', { pack }, '2026-07-01', '2026-09-30', ledger);
  const filed = GR.returnFor(pack, '2026-Q1', ledger, { simpler: false });
  const boxes = Split.splitBoxes(GR.returnFor, pack, '2026-Q1', ledger, { simpler: false }, Period.boxesOf(fullChart(pack), filed.boxes), 'AUD');
  return { filed, boxes };
};
/* the shop's chart: every ledger of the pack's own chart, so a box lists the ledgers the live screen lists (never only the ones with a movement) */
function fullChart(pack) {
  return (pack.ledgers || []).map((a) => ({ code: String(a.code), name: a.name, role: a.role, is_group: !!a.is_group }));
}
const get = (res, code) => (res.boxes.find((b) => b.code === code) || {});
(async () => {
  console.log('— shipped pack: events off, every box ties —');
  ok('the shipped AU pack tags no return as an adjustment (held for 1141)', AU.returns.adjustments.events.length === 0 && AU.tax.badDebt === undefined);
  for (const name of Object.keys(FIX)) {
    const res = await run(AU, FIX[name].rows);
    res.boxes.forEach((b) => ok(name + ': box ' + b.code + ' ties to its ledgers (split_ok), drill sum ' + (b.amount_minor == null ? 'n/a' : b.accounts.reduce((a, x) => a + (x.amount_minor || 0), 0)), b.split_ok === true, JSON.stringify(b)));
    Object.keys(FIX[name].want).forEach((code) => ok(name + ': ' + code + ' = ' + FIX[name].want[code], res.filed.boxes.find((b) => b.code === code).amount_minor === FIX[name].want[code], JSON.stringify(res.filed.boxes.map((b) => [b.code, b.amount_minor]))));
  }
  console.log('— mutation: the held rules switched ON with the box roles unchanged → the 1B tie goes red —');
  const members = Adj.members(AU.previous[0]);
  const ON = Object.assign({}, AU, { tax: members.tax, returns: members.returns });
  const handle = { query: async (sql, params) => ({ rows: [params[3] === 'gst_collected' ? { dr_minor: 100, cr_minor: 0 } : { dr_minor: 0, cr_minor: 0 }] }) };
  const red = await run(ON, FIX['same-period return'].rows, { handle });
  ok('mutation: with the adjustment rules ON the same-period return moves to 1B (the walker\'s symptom)', get(red.filed, '1B').amount_minor === 100, JSON.stringify(red.filed.boxes.map((b) => [b.code, b.amount_minor])));
  ok('mutation: and the tie guard sees it: 1B split_ok is false', red.boxes.some((b) => b.split_ok === false));
  console.log('\n' + checks + ' checks');
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });
