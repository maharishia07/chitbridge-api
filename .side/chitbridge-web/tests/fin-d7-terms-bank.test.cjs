/**
 * tests/fin-d7-terms-bank.test.cjs — D7 finance, the web half.
 *   FIN-46 · the Terms form's "What this means" sentences, its seven rules (each with a fix field) and the Undo's value reader.
 *   FIN-27 · every state of the bank screen belongs to exactly one of the three groups.
 * Pure: the two screen files are read as text and run in a sandbox with stand-ins for the page's words, no browser, no network.
 * Run: node tests/fin-d7-terms-bank.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/* ── the Terms file, run with the page's words as stand-ins ── */
const sb = {
  EP: {}, window: { addEventListener() {} }, document: {}, console,
  tx: (s) => s,
  txf: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k]),
  txn: (one, other, n) => (n === 1 ? one : other).replace('{count}', n),
  esc: (s) => String(s),
  bkMoney: (m) => 'M' + m,
  bkCur: () => 'INR'
};
vm.createContext(sb);
vm.runInContext(read('cap-finance-terms.js') + '\nthis.__t = { ftSentences, ftRules, ftUndoVal, FT_Q: FT_QUESTIONS };', sb);
const J = (v) => JSON.parse(JSON.stringify(v)); /* arrays made inside the sandbox are another realm's: compare by value */
const T = sb.__t;
const X = (o) => Object.assign({ days: null, limit: null, on: false, rate: null, grace: 0, pct: null, within: null }, o);

it('FIN-46 · the preview says due, discount, late-after, interest and limit from the form (30 days, 5 grace, 2% in 10, 18% a year, limit 50000)', () => {
  const lines = J(T.ftSentences(X({ days: 30, grace: 5, pct: 2, within: 10, on: true, rate: 18, limit: 50000 }), 'INR'));
  assert.deepStrictEqual(lines, [
    'Due 30 days after the bill date.',
    '2% off if paid within 10 days of the bill.',
    'Preview: counted as late after day 35.',
    'Interest of 18% a year is shown from then, a day at a time. It is shown, never charged.',
    'Owes up to M50000 before you are warned.'
  ]);
});
it('FIN-46 · nothing set says so: no due date, no interest, no limit (never a guessed number)', () => {
  assert.deepStrictEqual(J(T.ftSentences(X({}), 'INR')), [
    'No credit days are set, so a bill has no due date.',
    'No interest is shown on late bills.',
    'No credit limit.'
  ]);
});
it('FIN-46 · 0 credit days is "due the day the bill is made"; interest off with a rate typed is still not shown', () => {
  const l = T.ftSentences(X({ days: 0, on: false, rate: 12 }), 'INR');
  assert.strictEqual(l[0], 'Due the day the bill is made.');
  assert.ok(l.indexOf('No interest is shown on late bills.') >= 0);
});
it('FIN-46 · the seven rules each name a field to fix: days · limit · rate range · grace · interest needs a rate · discount needs days · window past the due date', () => {
  const rules = T.ftRules(X({ days: 2.5, limit: -1, rate: 150, grace: 4000, on: true, pct: 5, within: 40 }), 'fts');
  assert.deepStrictEqual(J(rules).map((r) => r.field).sort(), ['fts_days', 'fts_edays', 'fts_grace', 'fts_limit', 'fts_rate'], 'days · limit · rate · grace · window');
  const need = T.ftRules(X({ on: true, rate: null }), 'fts');
  assert.deepStrictEqual(J(need).map((r) => r.field), ['fts_rate']);
  const days = T.ftRules(X({ pct: 5, within: null }), 'fts');
  assert.deepStrictEqual(J(days).map((r) => r.field), ['fts_edays']);
  const past = T.ftRules(X({ days: 30, pct: 2, within: 45 }), 'fts');
  assert.deepStrictEqual(J(past).map((r) => r.field), ['fts_edays']);
  const seven = T.ftRules(X({ days: 2.5, limit: -1, rate: 150, grace: 1.5, on: true, pct: 150, within: null }), 'ftp');
  assert.ok(seven.every((r) => /^ftp_/.test(r.field) && r.text && r.fix), 'every rule has a field, a sentence and a fix word');
});
it('FIN-46 · a clean form has no rule to break (2/10 net 30, interest 18%, no limit)', () => {
  assert.deepStrictEqual(J(T.ftRules(X({ days: 30, pct: 2, within: 10, on: true, rate: 18, grace: 3 }), 'fts')), []);
});
it('FIN-46 · a box holding a non-number is one rule with the form\'s own sentence', () => {
  const r = T.ftRules({ bad: 'Numbers only, please' }, 'fts');
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].text, 'Numbers only, please');
});
it('FIN-46 · Undo reads the stored old value: a number, the interest/early object (or its JSON text), null clears', () => {
  assert.strictEqual(T.ftUndoVal('credit_days', '30'), 30);
  assert.strictEqual(T.ftUndoVal('credit_days', null), null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(T.ftUndoVal('interest', '{"on":true,"rate_pct":18,"grace_days":3}'))), { on: true, rate_pct: 18, grace_days: 3 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(T.ftUndoVal('early', { pct: 2, within_days: 10 }))), { pct: 2, within_days: 10 });
});
it('FIN-27 · a CSV cell: a plain number (negative too) stays a number, a formula is still quoted', () => {
  const src = read('cap-books.js'), from = src.indexOf('function bkCsvCell'), body = src.slice(from, src.indexOf('function bkSaveCsv'));
  const cell = new Function(body + 'return bkCsvCell;')();
  assert.strictEqual(cell('-1250.50'), '-1250.50'); assert.strictEqual(cell('42'), '42');
  assert.strictEqual(cell('=1+1'), "'=1+1"); assert.strictEqual(cell('-1+2'), "'-1+2"); assert.strictEqual(cell('+5'), "'+5");
});
it('FIN-46 · the four questions come in the customer\'s and the supplier\'s words, four each', () => {
  assert.strictEqual(T.FT_Q.customer.length, 4); assert.strictEqual(T.FT_Q.supplier.length, 4);
  assert.ok(!/₹|GST|lakh/i.test(JSON.stringify(T.FT_Q)), 'country-neutral');
});

/* ── the bank file: the three groups ── */
const bank = read('cap-bank.js');
const cut = (a, b) => bank.slice(bank.indexOf(a), bank.indexOf(b));
const sb2 = {};
vm.createContext(sb2);
vm.runInContext(cut('const BKB_GROUPS', 'const BKB_ORDER') + '\n' + cut('const BKB_ORDER', '/* ── ON THIS DEVICE') + '\nthis.__b = { BKB_GROUPS, bkbGroupOf, BKB_ORDER };', sb2);
const statusKeys = [...bank.slice(bank.indexOf('const bkbStatus'), bank.indexOf('const BKB_GROUPS')).matchAll(/^\s+'?([a-z-]+)'?: \['/gm)].map((m) => m[1]);
it('FIN-27 · every engine state is in exactly one of the three groups (' + statusKeys.join(' ') + ')', () => {
  assert.ok(statusKeys.length >= 10, 'found the states');
  statusKeys.forEach((st) => assert.strictEqual(sb2.__b.BKB_GROUPS.filter((g) => g.states.indexOf(st) >= 0).length, 1, st));
  assert.strictEqual(sb2.__b.BKB_GROUPS.length, 3);
  assert.deepStrictEqual(J(sb2.__b.BKB_GROUPS).map((g) => g.label), ['Missing in your books', 'Matched', 'Missing in the bank']);
});
it('FIN-27 · the groups\' counts add up to the rows (a state nobody listed counts as missing in your books)', () => {
  const rows = [].concat(statusKeys, ['mystery']).map((s) => ({ status: s }));
  const n = (k) => rows.filter((r) => sb2.__b.bkbGroupOf(r.status) === k).length;
  assert.strictEqual(n('books') + n('matched') + n('bank'), rows.length);
  assert.strictEqual(n('matched'), 3); assert.strictEqual(n('bank'), 2);
});

console.log('\n' + pass + ' checks passed\n');
