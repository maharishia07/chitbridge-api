/**
 * tests/ledger-columns.test.cjs — the Ledgers grid's columns and default order (W15-87 / 88 / 89 / 90).
 *   a cash or bank ledger reads Date · Details · Spent · Received · Balance; every other ledger Date · Details · Amount (Dr/Cr) · Balance
 *   Date's first sort is OLDEST first (so the header's ▲ = ascending is true)
 *   the Details line carries no time and no "recorded" note (both are in the opened entry)
 *   a first visit opens on the main bank ledger (role bank), else the first Cash & bank ledger
 * Pure: the named functions are cut out of public/app/cap-books.js as text and run in a sandbox with stand-ins for the page's words.
 * Run: node tests/ledger-columns.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-books.js'), 'utf8');
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/* one top-level function or one-line var, cut out by name */
const fn = (name) => {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert(at >= 0, 'no function ' + name);
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end + 3);
};
const line = (name) => {
  const m = src.match(new RegExp('\\nvar ' + name + ' = [^\\n]*'));
  assert(m, 'no var ' + name);
  return m[0];
};
const sb = {
  BK: { lt: { sel: { code: '1500' }, model: [] } },
  tx: (s) => s,
  esc: (s) => String(s),
  bkMoney: (v) => 'M' + v,
  bkDrCr: (v) => 'M' + Math.abs(v) + (v > 0 ? ' Dr' : v < 0 ? ' Cr' : ''),
  bkLgDash: () => '-',
  bkBillPart: () => '',
  bkQuiet: () => {}
};
vm.createContext(sb);
vm.runInContext(
  [line('BK_CASHBANK'), line('BK_LG_MONEY_W'), fn('bkLgIsBank'), fn('bkNoWrap'), fn('bkLgDefaultCols'), fn('bkLgMoneyCols'), fn('bkLtMainBank')].join('\n') +
    '\nthis.__t = { bkLgIsBank, bkLgDefaultCols, bkLgMoneyCols, bkLtMainBank };',
  sb
);
const T = sb.__t, J = (v) => JSON.parse(JSON.stringify(v));
const sel = (code) => { sb.BK.lt.sel = { code }; };
const textOf = (html) => String(html).replace(/<[^>]*>/g, '');

it('W15-88 · a cash or bank ledger opens Spent and Received then Balance; a plain ledger Amount then Balance', () => {
  sel('1500');
  assert.deepStrictEqual(J(T.bkLgDefaultCols('plain')), ['date', 'what', 'spent', 'received', 'bal']);
  sel('1400');
  assert.deepStrictEqual(J(T.bkLgDefaultCols('plain')), ['date', 'what', 'spent', 'received', 'bal']);
  sel('6010');
  assert.deepStrictEqual(J(T.bkLgDefaultCols('plain')), ['date', 'what', 'amount', 'bal']);
  assert.deepStrictEqual(J(T.bkLgDefaultCols('party')), ['date', 'what', 'amount', 'bal']);
  assert.deepStrictEqual(J(T.bkLgDefaultCols('control')), ['date', 'party', 'what', 'amount']);
});
it('W15-88 · a party under a cash code is not a bank ledger; the money columns come before Balance', () => {
  sel('1500');
  assert.strictEqual(T.bkLgIsBank('party'), false);
  assert.deepStrictEqual(J(T.bkLgMoneyCols('AUD', false, true)).map((c) => c.key), ['spent', 'received', 'bal']);
  assert.deepStrictEqual(J(T.bkLgMoneyCols('AUD', false, false)).map((c) => c.key), ['amount', 'bal']);
});
it('W15-88 · Spent shows the credit, Received the debit, no Dr/Cr word; Amount keeps Dr/Cr; every figure is no-wrap', () => {
  const [spent, received, bal] = T.bkLgMoneyCols('AUD', false, true);
  const out = { dr_minor: 0, cr_minor: 500, running_minor: 1200, _ix: 3 }, inn = { dr_minor: 700, cr_minor: 0, running_minor: 1900, _ix: 4 };
  assert.strictEqual(textOf(spent.cell(out)), 'M500');
  assert.strictEqual(textOf(received.cell(out)), '-');
  assert.strictEqual(textOf(received.cell(inn)), 'M700');
  assert.strictEqual(textOf(bal.cell(inn)), 'M1900 Dr');
  assert(/white-space:nowrap/.test(bal.cell(inn)) && /white-space:nowrap/.test(spent.cell(out)));
  const [amount] = T.bkLgMoneyCols('AUD', false, false);
  assert.strictEqual(textOf(amount.cell(inn)), 'M700 Dr');
  assert.strictEqual(textOf(amount.cell(out)), 'M500 Cr');
});
it('W15-87 · the first Date sort is oldest first, so the default ▲ (ascending) matches the order', () => {
  assert(/key: 'date',\s*label: tx\('Oldest first'\),\s*cmp: function \(a, b\) \{\s*return String\(a\.date\)\.localeCompare\(String\(b\.date\)\)/.test(src));
  assert(!/label: tx\('Newest first'\)/.test(src));
});
it('W15-89 · the Details line has no time and no recorded note; the opened entry has both', () => {
  const d = fn('bkLgDetails');
  assert(!/bkRecordedHTML/.test(d) && /bkBillPart\(s, tid, true\)/.test(d));
  const n = fn('bkLgNext') + fn('bkLgFacts');
  assert(/bkRecordedHTML\(line/.test(n) && /bkTime\(source\.doc_at\)/.test(n));
  assert(/function bkBillPart\(s, tid, noTime\)/.test(src) && /s\.doc_at && !noTime/.test(src));
});
it('W15-90 · a first visit opens on the bank-role ledger, else the first Cash & bank one, else nothing', () => {
  const mk = (accts) => { sb.BK.lt.model = [{ groups: [{ accts }] }]; };
  mk([{ code: '1400', role: 'cash' }, { code: '1500', role: 'bank' }]);
  assert.strictEqual(T.bkLtMainBank().code, '1500');
  mk([{ code: '1400', role: 'cash' }, { code: '1450', role: 'petty' }]);
  assert.strictEqual(T.bkLtMainBank().code, '1400');
  mk([{ code: '6010', role: 'rent' }]);
  assert.strictEqual(T.bkLtMainBank(), null);
  const r = fn('bkLtRestore');
  assert(/bkLtMainBank\(\)/.test(r) && /BK\.lt\.sel \|\| bkLtNarrow\(\)/.test(r));
});
console.log(pass + ' passed');

/* W15-89b · Details names what the money was for and who got it, from the api's own other / party_name */
{
  const sb2 = { BK: { lt: { sel: { code: '6010' } } }, tx: (s) => s, esc: (s) => String(s), txn: (a) => a, bkLgKind: () => 'plain', bkEntryWord: (l) => l.what, BK_SRC_WORD: {}, bkBillPart: () => '', bkLineChips: () => '' };
  vm.createContext(sb2);
  vm.runInContext([fn('bkLgOtherWords'), fn('bkLgPlainOther'), fn('bkLgWhatHTML'), fn('bkLgDetails')].join('\n') + '\nthis.__d = { bkLgOtherWords, bkLgDetails };', sb2);
  const D = sb2.__d;
  it('W15-89b · "Rent · Metro Trade Supplies" in place of the bare "Expense S042-20"; the bank\'s words and the entry number step back', () => {
    const l = { _ix: 0, what: 'Expense S042-20', ref: 'S042-20', other: { code: '6300', name: 'Rent' }, party_name: 'Metro Trade Supplies' };
    assert.strictEqual(D.bkLgOtherWords(l), 'Rent · Metro Trade Supplies');
    const html = D.bkLgDetails(l);
    assert.strictEqual(textOf(html), 'Rent · Metro Trade Supplies');
    assert.ok(/title="Expense S042-20"/.test(html) && !/S042-20<\/span>/.test(html.replace(/title="[^"]*"/, '')), 'the old words are the pointer text only');
  });
  it('W15-89b · several ledgers read "Split (3)"; no other side and no party leave the line as it was', () => {
    assert.strictEqual(D.bkLgOtherWords({ other: { code: null, name: 'Split', count: 3 }, party_name: null }), 'Split (3)');
    assert.strictEqual(D.bkLgOtherWords({ other: null, party_name: null }), '');
    const old = { _ix: 1, what: 'Expense S042-20', ref: 'S042-20' };
    assert.ok(/Expense S042-20/.test(textOf(D.bkLgDetails(old))) && /S042-20/.test(D.bkLgDetails(old)));
  });
}
