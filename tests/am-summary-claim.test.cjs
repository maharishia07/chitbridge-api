/**
 * am-summary-claim.test.cjs - AM-F-03 (walk AM, UAE, 21 Nov 2026; batch 1129 fixAM): a filed day summary is a CLAIM, the bills received are the evidence.
 * AM figures: C3 had ONE bill of AED 13.50 and its summary was sent as 6 bills / 113.50 (+5 bills, +100.00). The live day must read the bills (count 1, 13.50) and say
 * "Summary says more than its bills: AED 100.00 · 5 bills not received". A summary the bills back (listed or arrived before it) is untouched; a full live arm is not judged.
 * Break check: make claimGap return null and the first case fails (count 6, 113.50).
 * Run: node tests/am-summary-claim.test.cjs
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
const ctx = { isCounterTakings: require(path.join(root, 'lib', 'till-credit-note-money')).isCounterTakings, require: (m) => require(path.join(root, m.replace(/^\.\.\//, ''))), Date, Array, Set, Map, Math, Number, Object };
vm.createContext(ctx);
ctx.billRow = (row) => ({ no: row.business_json.bill_no, till: { id: row.business_json.till.id, name: null }, kind: 'sale', total: row.total, payments: [{ how: 'cash', amount: row.total }], refunds: [] });
vm.runInContext(['engineRow', 'tillKeyOf', 'rungAt', 'receivedAt'].map((n) => src.match(new RegExp('^const ' + n + ' = .*$', 'm'))[0]).concat(['distinctBills', 'inFiling', 'claimGap', 'claimWords', 'liveSummaries'].map(grab)).join('\n') + '\nthis.liveSummaries = liveSummaries; this.claimWords = claimWords;', ctx);
const R = require(path.join(root, 'lib', 'rollup.js'));
const day = '2026-11-21', filedAt = '2026-11-21T10:00:00.000Z';
const bill = (no, total, till) => ({ chit_id: no, created_at: '2026-11-21T09:00:00.000Z', total, business_json: { bill_no: no, billed_at: '2026-11-21T08:00:00.000Z', till: { id: till } } });
const filed = (till, count, gross, extra) => Object.assign(R.summary('day', day, { count, returns: 0, gross, refunds: 0, reduced: 0, expenseCount: 0, expenses: 0, total: gross, by: { cash: gross } }, { till: { id: till }, at: filedAt }), extra);
let n = 0; const ok = (what, fn) => { fn(); n++; console.log('  ok  ' + what); };
ok('AM-C13: C3 claims 6 bills / 113.50, holds 1 bill of 13.50: the day reads the bill, the gap is 5 bills / 100.00', () => {
  const claims = [];
  const got = ctx.liveSummaries([bill('C3/1', 13.5, 'C3')], [filed('C3', 6, 113.5)], day, claims, 'AED');
  assert.strictEqual(got.length, 1);
  assert.deepStrictEqual([got[0].totals.count, got[0].totals.gross], [1, 13.5]);
  assert.deepStrictEqual(claims.map((c) => [c.till.id, c.count, c.gross]), [['C3', 5, 100]]);
});
ok('the claim reads in the owner\'s words, in the shop\'s money (fils to the unit)', () => {
  const words = ctx.claimWords({ key: day, till: { id: 'C3' }, count: 5, gross: 100 }, 'AED');
  assert.strictEqual(words.words, 'Summary says more than its bills: AED 100.00 · 5 bills not received');
  assert.strictEqual(words.gross_minor, 10000);
  assert.strictEqual(ctx.claimWords({ key: day, till: {}, count: 1, gross: 0.5 }, 'AED').words, 'Summary says more than its bills: AED 0.50 · 1 bill not received');
});
ok('a shop that states no currency has no money to compare: the claim is the bills not received, the words leave the amount out, nothing throws (was toFixed / a thrown XXX)', () => {
  const claims = [];
  ctx.liveSummaries([bill('C3/1', 13.5, 'C3')], [filed('C3', 6, 113.5)], day, claims, null);
  assert.deepStrictEqual(claims.map((c) => [c.count, c.gross]), [[5, null]]);
  const words = ctx.claimWords(claims[0], null);
  assert.strictEqual(words.words, 'Summary says more than its bills: 5 bills not received');
  assert.deepStrictEqual([words.gross_minor, words.currency], [null, null]);
});
ok('a summary that holds no bill at all (none received) reads zero and still tells the gap', () => {
  const claims = [];
  const got = ctx.liveSummaries([], [filed('C3', 2, 20)], day, claims, 'AED');
  assert.deepStrictEqual([got[0].totals.count, got[0].totals.gross], [0, 0]);
  assert.deepStrictEqual([claims[0].count, claims[0].gross], [2, 20]);
});
ok('a summary the bills back is untouched: no gap, the filed figure stands', () => {
  const claims = [];
  const got = ctx.liveSummaries([bill('C3/1', 13.5, 'C3')], [filed('C3', 1, 13.5)], day, claims, 'AED');
  assert.deepStrictEqual(got, []); assert.deepStrictEqual(claims, []);
});
ok('money alone over the bills (same count, +100.00 gross) is a gap of 0 bills / 100.00', () => {
  const claims = [];
  ctx.liveSummaries([bill('C3/1', 13.5, 'C3')], [filed('C3', 1, 113.5)], day, claims, 'AED');
  assert.deepStrictEqual([claims[0].count, claims[0].gross], [0, 100]);
});
ok('a late bill the summary does not list is added once on top of the BACKED summary', () => {
  const claims = [];
  const late = Object.assign(bill('C3/2', 10, 'C3'), { created_at: '2026-11-21T12:00:00.000Z' });
  const got = ctx.liveSummaries([bill('C3/1', 13.5, 'C3'), late], [filed('C3', 1, 13.5, { bill_nos: ['C3/1'] })], day, claims, 'AED');
  assert.deepStrictEqual([got[0].totals.count, got[0].totals.gross], [2, 23.5]); assert.deepStrictEqual(claims, []);
});
ok('no claims list (the live arm was full) means no judgement: the filed figure is kept as before', () => {
  const got = ctx.liveSummaries([bill('C3/1', 13.5, 'C3')], [filed('C3', 6, 113.5)], day, null);
  assert.deepStrictEqual(got, []);
});
ok('the route answers summary_says_more only when there is a gap, and the live arm full is not judged', () => {
  assert.ok(/if \(live\.claims\.length\) answer\.summary_says_more = live\.claims/.test(src));
  assert.ok(/found\.rows\.length < BILLS_MAX \? claims : null/.test(src));
});
console.log('\n  ' + n + ' passed');
