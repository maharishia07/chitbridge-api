/**
 * aj-double-count.test.cjs - AJ-F-08 remainder (walk AJ, 21 Nov 2026; batch 1129 counterDouble): a counter bill is counted ONCE in the live day.
 * The AJ C2/C3 shape: a counter files a day summary holding N bills; one of those bills' uploads arrives AFTER the filing (an offline resync).
 * It was folded on top of the summary again (count N+1, takings +1 bill). The summary now lists its bills (bill_nos); the live view keys by bill number + counter, one rule (routes/till.js inFiling).
 * Break check: replace the inFiling body by the time test alone and the late-upload case fails (count 4, not 3).
 * Run: node tests/aj-double-count.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'routes', 'till.js'), 'utf8');
function grab(name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' is gone from routes/till.js');
  let i = src.indexOf('{', at), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(at, i + 1);
}
const grabConst = (name) => { const m = src.match(new RegExp('^const ' + name + ' = .*$', 'm')); assert.ok(m, name + ' is gone'); return m[0]; };
const ctx = { require: (m) => require(path.join(root, m.replace(/^\.\.\//, ''))), Date, Array, Set, Map };
vm.createContext(ctx);
const billRow = (row) => ({ no: row.business_json.bill_no, till: { id: row.business_json.till.id, name: null }, kind: 'sale', total: row.total, payments: [{ how: 'cash', amount: row.total }], refunds: [] });
ctx.billRow = billRow;
vm.runInContext(['engineRow', 'tillKeyOf', 'rungAt', 'receivedAt'].map((n) => { const m = src.match(new RegExp('^const ' + n + ' = .*$', 'm')); return m ? m[0] : grab(n); }).concat(['distinctBills', 'inFiling', 'liveSummaries'].map(grab)).join('\n') + '\nthis.liveSummaries = liveSummaries;', ctx);
const R = require(path.join(root, 'lib', 'rollup.js'));
const day = '2026-11-21', filedAt = '2026-11-21T10:00:00.000Z';
const bill = (no, total, recv, till) => ({ chit_id: no, created_at: recv, total, business_json: { bill_no: no, billed_at: '2026-11-21T08:00:00.000Z', till: { id: till || 'C2' } } });
const filedWith = (nos, extra) => Object.assign(R.summary('day', day, R.totals(nos.map((n) => ({ kind: 'sale', total: 10, payments: [{ how: 'cash', amount: 10 }] }))), { till: { id: 'C2' }, at: filedAt }), extra);
let n = 0; const ok = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };
const live = (todays, filed) => ctx.liveSummaries(todays, filed, day);
const one = (sums) => sums.length ? [sums[0].totals.count, sums[0].totals.gross] : [0, 0];
ok('a late upload of a bill the filed summary already holds: count stays 3, takings unchanged', () => {
  const filed = filedWith(['C2/1', 'C2/2', 'C2/3'], { bill_nos: ['C2/1', 'C2/2', 'C2/3'] });
  const got = live([bill('C2/3', 10, '2026-11-21T12:00:00.000Z')], [filed]);
  assert.deepStrictEqual(one(got), [0, 0], 'nothing is folded on top'); // acrossCounters then keeps the filed figure: 3 bills, 30
  assert.deepStrictEqual([filed.totals.count, filed.totals.gross], [3, 30]);
});
ok('a bill the summary does NOT list, uploaded after it, is added once (count 4)', () => {
  const filed = filedWith(['C2/1', 'C2/2', 'C2/3'], { bill_nos: ['C2/1', 'C2/2', 'C2/3'] });
  const got = live([bill('C2/4', 10, '2026-11-21T12:00:00.000Z')], [filed]);
  assert.deepStrictEqual(one(got), [4, 40]);
});
ok('the same late bill sent twice is still one', () => {
  const filed = filedWith(['C2/1'], { bill_nos: ['C2/1'] });
  const got = live([bill('C2/4', 10, '2026-11-21T12:30:00.000Z'), bill('C2/4', 10, '2026-11-21T12:00:00.000Z')], [filed]);
  assert.deepStrictEqual(one(got), [2, 20]);
});
ok('an older summary with no list keeps the time rule (arrived before the filing: inside it; after: added)', () => {
  const filed = filedWith(['C2/1', 'C2/2'], {});
  assert.deepStrictEqual(one(live([bill('C2/2', 10, '2026-11-21T09:00:00.000Z')], [filed])), [0, 0]);
  assert.deepStrictEqual(one(live([bill('C2/9', 10, '2026-11-21T12:00:00.000Z')], [filed])), [3, 30]);
});
ok('another counter\'s bill with the same number is not inside this counter\'s summary', () => {
  const filed = filedWith(['1'], { bill_nos: ['1'] });
  const got = live([bill('1', 10, '2026-11-21T12:00:00.000Z', 'C3')], [filed]);
  assert.strictEqual(got.length, 1); assert.strictEqual(got[0].till.id, 'C3');
});
ok('both writers of a day summary list their bills (the page close and the desktop connector)', () => {
  assert.ok(/sum\.bill_nos = \(DAY_ROWS/.test(fs.readFileSync(path.join(root, 'tools/tally-connector/till.html'), 'utf8')));
  assert.ok(/sum\.bill_nos = nos;/.test(fs.readFileSync(path.join(root, 'tools/tally-connector/till.js'), 'utf8')));
});
console.log('\n  ' + n + ' passed');
