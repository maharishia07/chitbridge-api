'use strict';
/**
 * tests/acc-244-move-in-credit-type.test.cjs — ACC-244: Xero's Type decides the direction of an open item (ACCRECCREDIT / ACCPAYCREDIT = a credit note).
 * The API enum is certain; the CSV wording is GUESSED (no real export in hand): anything the table does not name is HELD, never read as an invoice.
 * Pure over the planner. Hand figures: a credit note of 110.00 on the receivable side is Cr debtors 110.00 (reduces what the customer owes).
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
    { party_id: 'p-bean', party_no: 'P-2', name: 'Bean Co', customer: false, supplier: true }
  ]
});
const HEAD = ['ContactName', 'InvoiceNumber', 'InvoiceDate', 'DueDate', 'InvoiceAmountDue', 'Type'];
const FIELD = { ContactName: 'contact', InvoiceNumber: 'invoice_no', InvoiceDate: 'date', DueDate: 'due_date', InvoiceAmountDue: 'amount_due', Type: 'doc_type' };
function plan(side, lines) {
  const rows = lines.map((l) => Object.fromEntries(HEAD.map((h, i) => [h, l[i]])));
  const cells = MI.cells('open_bills', { headers: HEAD, rows }, HEAD.map((h) => ({ incoming: h, field: FIELD[h] })));
  return MI.plan('open_bills', { source: 'xero', side, currency: 'AUD', country: 'AU', source_country: 'AU', rows: cells, world: world() });
}
const dc = (r) => [r.data.dr_minor, r.data.cr_minor];
const rec = (no, amount, type) => ['Harbour Cafe', no, '2026-06-28', '2026-07-28', amount, type];
const pay = (no, amount, type) => ['Bean Co', no, '2026-06-28', '2026-07-28', amount, type];

console.log('\nACC-244 · Type flips the direction');
t('receivable: ACCREC 800.00 is Dr debtors; ACCRECCREDIT 110.00 is Cr debtors 110.00 (the 2 x 110 swing is gone)', () => {
  const pl = plan('receivable', [rec('INV-0099', '800.00', 'ACCREC'), rec('CN-0011', '110.00', 'ACCRECCREDIT')]);
  assert.deepStrictEqual(pl.rows.map(dc), [[80000, 0], [0, 11000]]);
  assert.ok(/A credit of A\$110\.00/.test(pl.rows[1].why), pl.rows[1].why);
});
t('a credit note is a credit whatever sign the file prints: -110.00 is the same Cr 110.00 (one flip only)', () => {
  assert.deepStrictEqual(dc(plan('receivable', [rec('CN-0011', '-110.00', 'ACCRECCREDIT')]).rows[0]), [0, 11000]);
});
t('payable: ACCPAY 418.00 is Cr creditors; ACCPAYCREDIT 88.00 is Dr creditors', () => {
  const pl = plan('payable', [pay('B-9', '418.00', 'ACCPAY'), pay('SC-4', '88.00', 'ACCPAYCREDIT')]);
  assert.deepStrictEqual(pl.rows.map(dc), [[0, 41800], [8800, 0]]);
});
t('the words "Credit Note", "Invoice", "Bill" read, spaces and case folded; the bare word "Credit" is HELD (a Dr/Cr column says it too)', () => {
  const pl = plan('receivable', [rec('A', '10.00', 'credit note'), rec('B', '10.00', 'Invoice'), rec('C', '10.00', 'Credit')]);
  assert.deepStrictEqual(pl.rows.map((r) => r.action), ['add', 'add', 'hold']);
  assert.deepStrictEqual(dc(pl.rows[0]), [0, 1000]);
  assert.strictEqual(pl.rows[2].code, 'doc_type');
});
t('the wrong side is held: ACCPAYCREDIT in a sales file, ACCREC in a purchases file', () => {
  const a = plan('receivable', [rec('CN-77', '88.00', 'ACCPAYCREDIT')]).rows[0],
    b = plan('payable', [pay('INV-1', '88.00', 'ACCREC')]).rows[0];
  assert.deepStrictEqual([a.action, a.code, b.action, b.code], ['hold', 'doc_type', 'hold', 'doc_type']);
  assert.ok(/purchases document/.test(a.why) && /sales document/.test(b.why));
});
t('Prepayment / Overpayment / an unknown word are held, never booked as an invoice, and say they are moved in by hand', () => {
  const pl = plan('receivable', [rec('P-1', '50.00', 'Prepayment'), rec('O-1', '60.00', 'Overpayment'), rec('X-1', '70.00', 'Mystery')]);
  assert.deepStrictEqual(pl.rows.map((r) => r.action), ['hold', 'hold', 'hold']);
  assert.ok(/moved in by hand/.test(pl.rows[0].why) && /is not one this import reads/.test(pl.rows[2].why));
  assert.deepStrictEqual(pl.counts, { add: 0, merge: 0, skip: 0, hold: 3 });
});
t('ACCREC with a negative amount stays a credit (as before) and SAYS so in a note', () => {
  const r = plan('receivable', [rec('INV-5', '-50.00', 'ACCREC')]).rows[0];
  assert.deepStrictEqual(dc(r), [0, 5000]);
  assert.ok(r.data.notes.some((n) => /negative amount is read as a credit/.test(n)), JSON.stringify(r.data.notes));
});
t('no Type column or a blank Type cell: the amount\'s own sign, exactly as before', () => {
  const pl = plan('receivable', [rec('INV-1', '100.00', ''), rec('CN-1', '-20.00', '')]);
  assert.deepStrictEqual(pl.rows.map(dc), [[10000, 0], [0, 2000]]);
});
t('the proof knows the code', () => {
  assert.ok(require('../lib/move-in-proof').HOLD_CODES.includes('doc_type'));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
