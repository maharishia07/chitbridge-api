/**
 * till-rcv-batches.test.cjs — STK-FIX1b (2026-10-14): A SECOND SCANNED BATCH OF THE SAME PRODUCT IS ITS OWN RECEIVING LINE.
 * No DB, no network, no browser: the till master's own functions (rcvAdd · rcvLineFor · rcvBatchOf · rcvDiff · rcvCounted · lineFor)
 * run in a vm with RCV stubbed, the same way till-t2j does. Before this round rcvAdd matched by PRODUCT alone and Object.assign'd
 * the new lot over the old — batch B's code written over batch A's, the two counts added up under one lot.
 * Flow: P2P step 3 · goods receipt.
 */
'use strict';
const assert = require('assert'), path = require('path'), vm = require('vm');
const API = path.join(__dirname, '..');
let n = 0, bad = 0;
const ok = (label, fn) => { try { fn(); n++; console.log('  ok    ' + label); } catch (e) { bad++; console.log('  FAIL  ' + label + '\n        ' + (e && e.message)); } };
const PAGE = require('fs').readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const NL = String.fromCharCode(10);
const grab = (name) => {
  let i = PAGE.indexOf(NL + 'function ' + name + '(');
  assert(i >= 0, name + ' is in the page');
  i++;
  const line = PAGE.slice(i, PAGE.indexOf(NL, i));
  return line.trimEnd().endsWith('}') ? line : PAGE.slice(i, PAGE.indexOf(NL + '}' + NL, i) + 2);
};
/** the page's receive functions over a stub RCV; `engine` = true loads lib/lotfields as CBLots (the one key normaliser) */
const mk = (engine) => {
  const ctx = { RCV: { lines: [] }, r2: (x) => Math.round((Number(x) || 0) * 100) / 100, paintReceive: () => {},
    rcvDefaultRate: () => null, window: engine ? { CBLots: require(path.join(API, 'lib', 'lotfields.js')) } : {}, esc: (x) => String(x) };
  ctx.CBLots = ctx.window.CBLots;
  vm.createContext(ctx);
  vm.runInContext(['lineFor', 'rcvBatchOf', 'rcvLineFor', 'rcvAdd', 'rcvDiff', 'rcvCounted'].map(grab).join(NL), ctx);
  return ctx;
};
const PILL = { item_id: 'p1', name: 'Paracetamol 500', unit: 'strip', price: 10 };
const view = (c) => c.RCV.lines.map((l) => [l.counted, l.lot && (l.lot.batch || l.lot.serial) || null, l.lot && l.lot.expiry || null]);

console.log(NL + '-- STK-FIX1b · a second batch is its own line --');
ok('batch A, then batch B of the same product → TWO lines, each with its own code, count and expiry', () => {
  const c = mk(true);
  c.rcvAdd(PILL, 10, { batch: 'AC2431', expiry: '2028-03-31' });
  c.rcvAdd(PILL, 5, { batch: 'AC2432', expiry: '2027-01-31' });
  assert.deepStrictEqual(view(c), [[10, 'AC2431', '2028-03-31'], [5, 'AC2432', '2027-01-31']]);
});
ok('the same batch scanned again lands on ITS line (counts add; the code is not written over)', () => {
  const c = mk(true);
  c.rcvAdd(PILL, 10, { batch: 'AC2431', expiry: '2028-03-31' });
  c.rcvAdd(PILL, 5, { batch: 'AC2432', expiry: '2027-01-31' });
  c.rcvAdd(PILL, 2, { batch: ' ac2431 ' });   /* lotKey: trimmed, upper-cased — the SAME batch as the first */
  assert.deepStrictEqual(view(c), [[12, 'AC2431', '2028-03-31'], [5, 'AC2432', '2027-01-31']]);
});
ok('a plain count (no batch) then a scan: the batch fills the seam of the line that had none — as before', () => {
  const c = mk(true);
  c.rcvAdd(PILL, 3);
  c.rcvAdd(PILL, 4, { batch: 'AC2431' });
  assert.deepStrictEqual(view(c), [[7, 'AC2431', null]]);
});
ok('a plain count after two batches goes on the line most recently counted', () => {
  const c = mk(true);
  c.rcvAdd(PILL, 10, { batch: 'AC2431' }); c.rcvAdd(PILL, 5, { batch: 'AC2432' }); c.rcvAdd(PILL, 1);
  assert.deepStrictEqual(view(c), [[10, 'AC2431', null], [6, 'AC2432', null]]);
});
ok('the ORDER line: two batches keep its line_id and count together — a delivery in two batches is not a shortage', () => {
  const c = mk(true);
  c.RCV.lines.push({ line_id: 'L1', item_id: 'p1', name: 'Paracetamol 500', unit: 'strip', ordered: 15, counted: null, rate: 9.5, reason: '', lot: null, gst_rate: 12 });
  c.rcvAdd(PILL, 10, { batch: 'AC2431' });
  c.rcvAdd(PILL, 5, { batch: 'AC2432' });
  assert.strictEqual(c.RCV.lines.length, 2);
  assert.strictEqual(c.RCV.lines[1].line_id, 'L1', 'the second batch names the ordered line');
  assert.strictEqual(c.RCV.lines[1].ordered, null, 'but carries no ordered quantity of its own');
  assert.strictEqual(c.RCV.lines[1].rate, 9.5, 'and the rate of the line it belongs to');
  assert.strictEqual(c.RCV.lines[1].gst_rate, 12, 'and its GST on their bill');
  assert.strictEqual(c.rcvCounted(c.RCV.lines[0]), 15);
  assert.strictEqual(c.rcvDiff(c.RCV.lines[0]), 0, 'ordered 15, counted 10 + 5: no difference');
  assert.strictEqual(c.rcvDiff(c.RCV.lines[1]), 0, 'a batch line has no difference of its own');
  c.rcvAdd(PILL, 1, { batch: 'AC2432' });
  assert.strictEqual(c.rcvDiff(c.RCV.lines[0]), 1, 'one more strip of batch B: excess 1 on the ordered line');
});
ok('a serial-tracked pack keys on its serial; two serials are two lines', () => {
  const c = mk(true);
  const PHONE = { item_id: 'p2', name: 'Phone', unit: 'piece', price: 900 };
  c.rcvAdd(PHONE, 1, { serial: 'SN1' }); c.rcvAdd(PHONE, 1, { serial: 'SN2' }); c.rcvAdd(PHONE, 1, { serial: 'SN1' });
  assert.deepStrictEqual(view(c), [[2, 'SN1', null], [1, 'SN2', null]]);
});
ok('no engine on the page: codes compare as typed — two different codes are still never one line', () => {
  const c = mk(false);
  assert.strictEqual(c.rcvBatchOf({ batch: ' x1 ' }), 'x1');
  assert.strictEqual(c.rcvBatchOf({ mrp: 30 }), null, 'a lot with no batch names none');
  assert.strictEqual(c.rcvBatchOf(null), null);
  c.rcvAdd(PILL, 1, { batch: 'A' }); c.rcvAdd(PILL, 1, { batch: 'B' });
  assert.strictEqual(c.RCV.lines.length, 2);
});
ok('two different products are still two lines (and a product not on the receipt is a new line)', () => {
  const c = mk(true);
  c.rcvAdd(PILL, 1, { batch: 'A' }); c.rcvAdd({ item_id: 'p3', name: 'Dal 1kg', unit: 'piece', price: 120 }, 2);
  assert.deepStrictEqual(c.RCV.lines.map((l) => l.item_id), ['p1', 'p3']);
});

console.log(NL + n + ' passed' + (bad ? ', ' + bad + ' FAILED' : '') + ' · ' + (n + bad) + ' checks' + NL);   /* "<n> checks" — the grammar scripts/guards.cjs counts by */
process.exit(bad ? 1 : 0);
