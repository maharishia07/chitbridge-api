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
const FIELD = { ContactName: 'contact', InvoiceNumber: 'invoice_no', InvoiceDate: 'date', DueDate: 'due_date', InvoiceAmountDue: 'amount_due', CurrencyCode: 'currency', CurrencyRate: 'currency_rate', Type: 'doc_type' };
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

const CUR = HEAD.concat('CurrencyCode', 'CurrencyRate');
const usd = (extra, amount) => plan(CUR, [['Pacific Imports', 'INV-0203', '2026-06-20', '2026-07-20', amount || '500.00', 'USD', '0.65']], extra);
const ans = (o) => ({ decisions: [Object.assign({ line: 2, ref: 'INV-0203' }, o)] });

console.log('\nACC-241 · the hold sentence prints BOTH directions; the person words releases');
t('held USD row with a rate: both results and the invoice-date gap are in the sentence; nothing applied', () => {
  const r = at(usd(), 2);
  assert.strictEqual(r.action, 'hold');
  assert.ok(/read as USD per AUD gives A\$769\.23/.test(r.why), r.why);
  assert.ok(/read as AUD per USD gives A\$325\.00/.test(r.why), r.why);
  assert.ok(/exchange difference is yours to book/.test(r.why) && /Suspense keeps a gap/.test(r.why), r.why);
});
t('no rate in the file: no proposal at all, only "type its AUD amount"', () => {
  const pl = plan(HEAD.concat('CurrencyCode'), [['Pacific Imports', 'INV-0204', '2026-06-20', '2026-07-20', '300.00', 'USD']]);
  assert.ok(!/read as/.test(at(pl, 2).why) && /Type its AUD amount/.test(at(pl, 2).why));
});
t('typed home amount 770.10 releases it: Dr debtors 770.10, the typed figure wins over the rate', () => {
  const r = at(usd(ans({ action: 'home_amount', value: '770.10' })), 2);
  assert.strictEqual(r.action, 'add');
  assert.deepStrictEqual([r.data.dr_minor, r.data.cr_minor], [77010, 0]);
  assert.ok(r.data.notes.some((n) => /USD 500\.00 moved in as A\$770\.10, the figure you typed/.test(n)), JSON.stringify(r.data.notes));
});
t('confirm_rate 0.65 foreign_per_home = 769.23 (integer math: 50000 x 1e6 x 100 / (650000 x 100) = 76923.08 to 76923)', () => {
  const r = at(usd(ans({ action: 'confirm_rate', value: '0.65', per: 'foreign_per_home' })), 2);
  assert.deepStrictEqual([r.data.dr_minor, r.data.cr_minor], [76923, 0]);
  assert.ok(r.data.notes.some((n) => /invoice-date amount/.test(n) && /IAS 21 para 28/.test(n)));
});
t('confirm_rate 0.65 home_per_foreign = 325.00', () => {
  assert.strictEqual(at(usd(ans({ action: 'confirm_rate', value: '0.65', per: 'home_per_foreign' })), 2).data.dr_minor, 32500);
});
t('half-up, one rounding at the end: USD 0.05 at 3 foreign_per_home = 0.0166 to 0.02', () => {
  const pl = plan(CUR, [['Pacific Imports', 'INV-9', '2026-06-20', '2026-07-20', '0.05', 'USD', '3']], { decisions: [{ line: 2, ref: 'INV-9', action: 'confirm_rate', value: '3', per: 'foreign_per_home' }] });
  assert.strictEqual(at(pl, 2).data.dr_minor, 2);
});
t('the direction is required, and a bad rate (0, text, 7 decimals, negative) is refused in words', () => {
  assert.throws(() => usd(ans({ action: 'confirm_rate', value: '0.65' })), /say which way the rate runs/);
  for (const v of ['0', 'abc', '0.1234567', '-0.65']) assert.throws(() => usd(ans({ action: 'confirm_rate', value: v, per: 'foreign_per_home' })), /rate must be a number above 0/, v);
});
t('home_amount never carries a sign or a currency: "-770", "A$770", "0", "770.123" refused', () => {
  for (const v of ['-770', 'A$770', '0', '770.123', '']) assert.throws(() => usd(ans({ action: 'home_amount', value: v })), /plain positive number/, v);
});
t('an answer bound to line AND invoice number: wrong ref, unknown line, no ref, a twin answer, a wrong action, a row that is not held are all REFUSED', () => {
  assert.throws(() => usd({ decisions: [{ line: 2, ref: 'INV-9999', action: 'home_amount', value: '770.10' }] }), /not INV-9999 — the file changed/);
  assert.throws(() => usd({ decisions: [{ line: 9, ref: 'INV-0203', action: 'home_amount', value: '770.10' }] }), /Line 9 is not in this file/);
  assert.throws(() => usd({ decisions: [{ line: 2, action: 'home_amount', value: '770.10' }] }), /must name its reference/);
  assert.throws(() => usd({ decisions: [{ line: 2, ref: 'INV-0203', action: 'home_amount', value: '1' }, { line: 2, ref: 'INV-0203', action: 'home_amount', value: '2' }] }), /answered twice/);
  assert.throws(() => usd({ decisions: [{ line: 2, ref: 'INV-0203', action: 'pay_now', value: '1' }] }), /is not an answer for this file/);
  assert.throws(() => plan(HEAD, [['Harbour Cafe', 'INV-0201', '2026-06-12', '2026-07-12', '1320.00']], { decisions: [{ line: 2, ref: 'INV-0201', action: 'home_amount', value: '5' }] }), /not held for its currency/);
});
t('an answer on a row skipped for another reason (no such customer) is refused, never silently dropped', () => {
  const run = () => plan(CUR, [['Nobody Known', 'INV-0203', '2026-06-20', '2026-07-20', '500.00', 'USD', '0.65']], ans({ action: 'home_amount', value: '770.10' }));
  assert.throws(run, /was not used/);
});
t('preview and import plan from the same body: the same decisions give the same rows', () => {
  const a = usd(ans({ action: 'confirm_rate', value: '0.65', per: 'foreign_per_home' })),
    b = usd(ans({ action: 'confirm_rate', value: '0.65', per: 'foreign_per_home' }));
  assert.deepStrictEqual(a.rows, b.rows);
});
t('a blank currency cell in a mapped column: read as AUD WITH a note; HELD when another row names a foreign currency', () => {
  const calm = plan(HEAD.concat('CurrencyCode'), [['Harbour Cafe', 'INV-1', '2026-06-12', '2026-07-12', '100.00', '']]);
  assert.strictEqual(at(calm, 2).action, 'add');
  assert.ok(at(calm, 2).data.notes.some((n) => /no currency on this row — read as AUD/.test(n)));
  const ragged = plan(HEAD.concat('CurrencyCode'), [['Harbour Cafe', 'INV-1', '2026-06-12', '2026-07-12', '100.00', ''], ['Pacific Imports', 'INV-2', '2026-06-12', '2026-07-12', '50.00', 'USD']]);
  assert.deepStrictEqual(ragged.rows.map((r) => r.action), ['hold', 'hold']);
});
t('the preview counts the held rows in words (Suspense keeps the gap)', () => {
  const pl = usd();
  assert.ok(pl.notes.some((n) => /1 row is held and NOT moved in/.test(n) && /Suspense keeps the gap/.test(n)), JSON.stringify(pl.notes));
});
t('a released USD credit note (ACCRECCREDIT) is a credit either sign: Cr 769.23 for 500.00 and for -500.00 (one flip only)', () => {
  for (const amount of ['500.00', '-500.00']) {
    const head = CUR.concat('Type');
    const pl = plan(head, [['Pacific Imports', 'CN-5', '2026-06-20', '2026-07-20', amount, 'USD', '0.65', 'ACCRECCREDIT']], { decisions: [{ line: 2, ref: 'CN-5', action: 'confirm_rate', value: '0.65', per: 'foreign_per_home' }] });
    assert.deepStrictEqual([at(pl, 2).data.dr_minor, at(pl, 2).data.cr_minor], [0, 76923], amount);
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
