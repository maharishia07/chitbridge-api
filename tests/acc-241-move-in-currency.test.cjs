'use strict';
/**
 * tests/acc-241-move-in-currency.test.cjs — ACC-241: an open invoice or bill in a currency other than the shop's is HELD, never read as the shop's.
 * The amount cell's own text counts too: csv-preflight looseNumber strips "USD", "US$", "€" and reads 500 (the biz-mvi-04 S5 bug on a second door).
 * Fixtures are GUESSED Xero column names (API field names CurrencyCode / CurrencyRate; no real CSV in hand): the person confirms the columns.
 * Pure over the planner (no database).
 */
const assert = require('assert');
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
      parent_id: r.parent ? (ids.get((rows.find((x) => x.key === r.parent && x.is_group) || {}).code) || null) : null,
      is_group: r.is_group,
      nature: r.nature,
      role: r.role || null,
      active: true,
      source_code: null
    };
  });
}
const world = () => ({
  pack: AU,
  chart: chartFromPack(AU),
  parties: [
    { party_id: 'p-harbour', party_no: 'P-1', name: 'Harbour Cafe', customer: true, supplier: false },
    { party_id: 'p-pacific', party_no: 'P-2', name: 'Pacific Imports', customer: true, supplier: false }
  ]
});
const HEAD = ['ContactName', 'InvoiceNumber', 'InvoiceDate', 'DueDate', 'InvoiceAmountDue'];
const FIELD = { ContactName: 'contact', InvoiceNumber: 'invoice_no', InvoiceDate: 'date', DueDate: 'due_date', InvoiceAmountDue: 'amount_due', CurrencyCode: 'currency' };
/** rows as cells(): `headers` the file's, `lines` arrays of the same length; every placed column confirmed */
function plan(headers, lines, extra) {
  const rows = lines.map((l) => Object.fromEntries(headers.map((h, i) => [h, l[i]])));
  const decisions = headers.filter((h) => FIELD[h]).map((h) => ({ incoming: h, field: FIELD[h] }));
  const cells = MI.cells('open_bills', { headers, rows }, decisions.concat((extra && extra.decisions) || []));
  return MI.plan('open_bills', { source: 'xero', side: 'receivable', currency: 'AUD', country: 'AU', source_country: 'AU', rows: cells, world: world() });
}
const at = (pl, n) => pl.rows.find((r) => r.line === n);

console.log('\nACC-241 · a foreign-currency open item is held');
t('a shop-currency row posts as before (Dr debtors 1,320.00)', () => {
  const pl = plan(HEAD, [['Harbour Cafe', 'INV-0201', '2026-06-12', '2026-07-12', '1320.00']]);
  assert.strictEqual(at(pl, 2).action, 'add');
  assert.deepStrictEqual([at(pl, 2).data.dr_minor, at(pl, 2).data.cr_minor], [132000, 0]);
});
t('"USD 500.00" in the amount cell with NO currency column is HELD, never A$500', () => {
  const pl = plan(HEAD, [['Pacific Imports', 'INV-0203', '2026-06-20', '2026-07-20', 'USD 500.00']]);
  assert.strictEqual(at(pl, 2).action, 'hold');
  assert.strictEqual(at(pl, 2).code, 'currency');
  assert.ok(/INV-0203 is in USD/.test(at(pl, 2).why), at(pl, 2).why);
  assert.strictEqual(at(pl, 2).data, null);
  assert.deepStrictEqual(pl.counts, { add: 0, merge: 0, skip: 0, hold: 1 });
});
t('"US$500", "€50.00", "£ 40", "usd 500" are all held; "A$1,320.00" and "AUD 1320" are the shop\'s and post', () => {
  const lines = ['US$500', '€50.00', '£ 40', 'usd 500', 'A$1,320.00', 'AUD 1320'].map((v, i) => ['Pacific Imports', 'INV-' + (300 + i), '2026-06-20', '2026-07-20', v]);
  const pl = plan(HEAD, lines);
  assert.deepStrictEqual(pl.rows.map((r) => r.action), ['hold', 'hold', 'hold', 'hold', 'add', 'add']);
  assert.deepStrictEqual([at(pl, 6).data.dr_minor, at(pl, 7).data.dr_minor], [132000, 132000]);
});
t('a mapped currency column: USD is held with a plain amount, AUD and the shop code in any case post', () => {
  const head = HEAD.concat('CurrencyCode');
  const pl = plan(head, [
    ['Pacific Imports', 'INV-1', '2026-06-20', '2026-07-20', '500.00', 'USD'],
    ['Pacific Imports', 'INV-2', '2026-06-20', '2026-07-20', '500.00', 'aud'],
    ['Pacific Imports', 'INV-3', '2026-06-20', '2026-07-20', '500.00', 'AUD']
  ]);
  assert.deepStrictEqual(pl.rows.map((r) => r.action), ['hold', 'add', 'add']);
  assert.strictEqual(at(pl, 2).code, 'currency');
});
t('the preview says when no currency column was picked, and not when one was', () => {
  const none = plan(HEAD, [['Harbour Cafe', 'INV-0201', '2026-06-12', '2026-07-12', '1320.00']]);
  assert.ok(none.notes.some((n) => /No currency column was picked: every row is read as AUD/.test(n)), JSON.stringify(none.notes));
  const some = plan(HEAD.concat('CurrencyCode'), [['Harbour Cafe', 'INV-0201', '2026-06-12', '2026-07-12', '1320.00', 'AUD']]);
  assert.deepStrictEqual(some.notes, []);
});
t('a held row is never in apply(): the held code is one the proof knows', () => {
  const MP = require('../lib/move-in-proof');
  assert.ok(MP.HOLD_CODES.includes('currency'));
});
t('a plain-number file is byte-equal to the plan before the change (fixture xero-aged.csv rows are all shop currency)', () => {
  const pl = plan(HEAD, [
    ['Harbour Cafe', 'INV-0041', '15 Jun 2026', '15 Jul 2026', '3,300.00'],
    ['Pacific Imports', 'CN-0002', '20 Jun 2026', '20 Jun 2026', '-220.00']
  ]);
  assert.deepStrictEqual(pl.rows.map((r) => [r.action, r.data.dr_minor, r.data.cr_minor]), [['add', 330000, 0], ['add', 0, 22000]]);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
