'use strict';
/**
 * tests/acc-231-move-in-role-ledgers.test.cjs — ACC-231: a move-in account lands on the pack's ROLE ledger instead of a new twin of it.
 *   · a revenue account whose default tax code is a supply kind the pack has a ledger for merges (GST-free → 4020, input-taxed → 4030), the BAS label in the sentence
 *   · a taxable revenue account, an OTHERINCOME account and a GST-free EXPORT account are never merged on their own
 *   · an expense or bank account is a preview row: candidates + (only when plainly closer) a suggestion; the person's confirmed `merge` makes it a merge
 *   · two accounts never land on one ledger; an answer is bound to line + their code and refused when unused or outside the candidates
 *   · DRIFT: the one-line kind rule is a local copy of engines posting.kindBase_; pinned against the adopted lib/posting.js and the AU / AE charts
 * Fixture rows are GUESSED Xero chart wording (no real export in hand). Pure over the planner.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MI = require('../lib/move-in');
const E = require('../lib/books-engines');
const AU = require('../lib/reg-au');

let pass = 0,
  fail = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  PASS  ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL  ' + name + '\n        ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n        '));
    fail++;
  }
};
function chartFromPack(pack) {
  const rows = E.chartRows(pack),
    ids = new Map();
  return rows.map((r, i) => {
    const id = '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0');
    ids.set(r.code, id);
    return {
      account_id: id,
      code: r.code,
      name: r.name,
      parent_id: r.parent ? ids.get((rows.find((x) => x.key === r.parent && x.is_group) || {}).code) || null : null,
      is_group: r.is_group,
      nature: r.nature,
      role: r.role || null,
      active: true,
      source_code: null
    };
  });
}
const HEAD = ['*Code', '*Name', '*Type', '*Tax Code'];
const FIELD = { '*Code': 'code', '*Name': 'name', '*Type': 'type', '*Tax Code': 'tax_code' };
function plan(lines, decisions, source) {
  const rows = lines.map((l) => Object.fromEntries(HEAD.map((h, i) => [h, l[i]])));
  const cells = MI.cells('accounts', { headers: HEAD, rows }, HEAD.map((h) => ({ incoming: h, field: FIELD[h] })).concat(decisions || []));
  return MI.plan('accounts', { source: source || 'xero', currency: 'AUD', country: 'AU', source_country: 'AU', rows: cells, world: { pack: AU, chart: chartFromPack(AU) } });
}
const at = (pl, n) => pl.rows.find((r) => r.line === n);

console.log('\nACC-231 · accounts land on the pack\'s role ledgers');
t('GST-free income merges to 4020 sales_gst_free and keeps their code; the sentence names the BAS label (G3)', () => {
  const r = at(plan([['205', 'Sales - GST Free', 'Revenue', 'GST Free Income']]), 2);
  assert.strictEqual(r.action, 'merge');
  assert.deepStrictEqual([r.data.code, r.data.source_code], ['4020', '205']);
  assert.ok(/BAS G3/.test(r.why) && /keeps Xero code 205/.test(r.why), r.why);
});
t('input-taxed income merges to 4030 sales_input_taxed (BAS label from the engine: G1)', () => {
  const r = at(plan([['206', 'Residential Rent Income', 'Revenue', 'Input Taxed']]), 2);
  assert.deepStrictEqual([r.action, r.data.code, r.data.source_code], ['merge', '4030', '206']);
  assert.ok(/BAS G1/.test(r.why), r.why);
});
t('a TAXABLE revenue account is never folded into Sales: it is added as its own ledger', () => {
  const r = at(plan([['210', 'Consulting', 'Revenue', 'GST on Income']]), 2);
  assert.strictEqual(r.action, 'add');
});
t('OTHERINCOME with a GST-free code is not touched (group other_income)', () => {
  assert.strictEqual(at(plan([['260', 'Interest Income', 'OtherIncome', 'GST Free Income']]), 2).action, 'add');
});
t('a GST-free EXPORT code is never merged by itself: added with the export + GST-free ledgers as candidates', () => {
  const r = at(plan([['207', 'Export Sales', 'Revenue', 'GST Free Exports']]), 2);
  assert.strictEqual(r.action, 'add');
  assert.deepStrictEqual(r.data.candidates.map((c) => c.code), ['4010', '4020']);
  assert.strictEqual(r.data.suggest, null);
});
t('the same on QuickBooks: "GST free" income merges to 4020 (the move-in map is per source)', () => {
  assert.deepStrictEqual([at(plan([['', 'Sales GST Free', 'Income', 'GST free']], null, 'qbo'), 2).action], ['merge']);
});
t('two GST-free income accounts in one file: the first takes 4020, the second is ADDED with a clear position (the ledger is taken)', () => {
  const pl = plan([['205', 'Sales - GST Free', 'Revenue', 'GST Free Income'], ['208', 'Other GST Free Sales', 'Revenue', 'GST Free Income']]);
  assert.deepStrictEqual(pl.rows.map((r) => r.action), ['merge', 'add']);
});
t('a ledger that already carries another source code falls back to ADD, not skip (a skip would leave their TB row with no ledger)', () => {
  const rows = [{ '*Code': '205', '*Name': 'GST Free Sales', '*Type': 'Revenue', '*Tax Code': 'GST Free Income' }];
  const cells = MI.cells('accounts', { headers: HEAD, rows }, HEAD.map((h) => ({ incoming: h, field: FIELD[h] })));
  const chart = chartFromPack(AU);
  chart.find((a) => a.role === 'sales_gst_free').source_code = '999';
  const pl = MI.plan('accounts', { source: 'xero', currency: 'AUD', country: 'AU', source_country: 'AU', rows: cells, world: { pack: AU, chart } });
  assert.strictEqual(pl.rows[0].action, 'add');
});

console.log('\nACC-231 · expense and bank accounts: a preview row the person confirms');
t('Bank Fees: added, with the candidates and the plain suggestion 6090; nothing merges by itself', () => {
  const r = at(plan([['404', 'Bank Fees', 'Expense', 'GST Free Expenses']]), 2);
  assert.strictEqual(r.action, 'add');
  assert.strictEqual(r.data.suggest, '6090');
  assert.ok(r.data.candidates.some((c) => c.code === '6090') && /Looks like your 6090/.test(r.why), r.why);
});
t('Light, Power, Heating and Cash Float: candidates but NO suggestion (names too far apart), nothing merges', () => {
  const pl = plan([['445', 'Light, Power, Heating', 'Expense', 'GST on Expenses'], ['091', 'Cash Float', 'Bank', 'BAS Excluded']]);
  assert.deepStrictEqual(pl.rows.map((r) => [r.action, r.data.suggest]), [['add', null], ['add', null]]);
  assert.ok(pl.rows[0].data.candidates.some((c) => c.code === '6030'));
  assert.deepStrictEqual(pl.rows[1].data.candidates.map((c) => c.code), ['1400']);
});
t('two near siblings get no suggestion: the margin over the second candidate is required', () => {
  const pl = plan([['480', 'Telephone', 'Expense', 'GST on Expenses']]);
  const r = at(pl, 2);
  assert.strictEqual(r.action, 'add');
});
t('the confirmed answer merges: Bank Fees to 6090, Light Power to 6030, Cash Float to 1400 — each keeps their code', () => {
  const pl = plan(
    [['404', 'Bank Fees', 'Expense', 'GST Free Expenses'], ['445', 'Light, Power, Heating', 'Expense', 'GST on Expenses'], ['091', 'Cash Float', 'Bank', 'BAS Excluded']],
    [{ line: 2, ref: '404', action: 'merge', code: '6090' }, { line: 3, ref: '445', action: 'merge', code: '6030' }, { line: 4, ref: '091', action: 'merge', code: '1400' }]
  );
  assert.deepStrictEqual(pl.rows.map((r) => [r.action, r.data.code, r.data.source_code]), [['merge', '6090', '404'], ['merge', '6030', '445'], ['merge', '1400', '091']]);
  assert.ok(/You confirmed/.test(pl.rows[0].why));
});
t('refused in words: two confirmations onto one ledger · a code outside the candidates · the wrong reference · an answer for a row with nothing to confirm · a twin', () => {
  const base = [['404', 'Bank Fees', 'Expense', 'GST Free Expenses'], ['405', 'Merchant Fees', 'Expense', 'GST Free Expenses']];
  assert.throws(() => plan(base, [{ line: 2, ref: '404', action: 'merge', code: '6090' }, { line: 3, ref: '405', action: 'merge', code: '6090' }]), /already taken by line 2/);
  assert.throws(() => plan(base, [{ line: 2, ref: '404', action: 'merge', code: '4000' }]), /not one of the ledgers offered/);
  assert.throws(() => plan(base, [{ line: 2, ref: '999', action: 'merge', code: '6090' }]), /the file changed/);
  assert.throws(() => plan([['210', 'Consulting', 'Revenue', 'GST on Income']], [{ line: 2, ref: '210', action: 'merge', code: '4000' }]), /not one of the ledgers offered/);
  assert.throws(() => plan([['404', 'Bank Fees', 'Expense', 'GST Free Expenses'], ['405', 'Bank Fees', 'Expense', 'GST Free Expenses']], [{ line: 3, ref: '405', action: 'merge', code: '6090' }]), /nothing to confirm/);
  assert.throws(() => plan(base, [{ line: 2, ref: '404', action: 'merge', code: '6090' }, { line: 2, ref: '404', action: 'merge', code: '6030' }]), /answered twice/);
});
t('preview and import plan from the same body: the same answers give the same rows', () => {
  const lines = [['404', 'Bank Fees', 'Expense', 'GST Free Expenses']],
    answers = [{ line: 2, ref: '404', action: 'merge', code: '6090' }];
  assert.deepStrictEqual(plan(lines, answers).rows, plan(lines, answers).rows);
});
t('the control accounts and exact names merge exactly as before (Accounts Receivable → 1300, Sales by name → 4000)', () => {
  const pl = plan([['610', 'Accounts Receivable', 'Current Asset', ''], ['200', 'Sales', 'Revenue', 'GST on Income']]);
  assert.deepStrictEqual(pl.rows.map((r) => r.action), ['merge', 'merge']);
});

console.log('\nACC-231 · DRIFT: the local kind rule against the posting engine and the charts');
t('the adopted lib/posting.js still derives the ledger as base + "_" + kind and skips only "standard" (the rule this file copies)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'posting.js'), 'utf8');
  assert.ok(/if \(!kind \|\| kind === 'standard'\) return base;/.test(src));
  assert.ok(/var role = base \+ '_' \+ kind;/.test(src));
});
t('every non-taxable kind id the AU move-in map can return has its own sales ledger in the AU chart; "taxable" has none (it falls to the base)', () => {
  const ids = ['gst_free', 'input_taxed'];
  const roles = new Set(AU.ledgers.map((l) => l.role));
  ids.forEach((id) => assert.ok(roles.has('sales_' + id), 'sales_' + id));
  assert.ok(!roles.has('sales_taxable'));
});
t('the map kinds are the three the posting rule knows: taxable · gst_free · input_taxed (a new kind fails here, not in a shop)', () => {
  const seen = new Set();
  ['xero', 'qbo'].forEach((src) => Object.values(AU.moveIn ? AU.moveIn[src].taxCodes : {}).forEach((id) => id && seen.add(id)));
  assert.deepStrictEqual(Array.from(seen).sort(), ['gst_free', 'input_taxed', 'taxable']);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
