'use strict';
/**
 * tests/lib/bill-total-fixtures.cjs — ONE SET OF STORED BILLS, one row per RULE-MATRIX column (ACC-206 C1; C2 and D1 reuse it).
 *
 * owns       the stored shapes a chit's money can have had (summary_json + business_json + the detail column), with the figures a hand
 *            works out BESIDE them: `taxable` (what the owner earned from, tax is not income) and `total` (what the buyer paid).
 * called by  tests/cost-margin-basis.test.cjs; later tests/bill-total-sql.test.cjs (C2) and the web byte copy (D1).
 * ⚠️ The expected figures are HAND figures from the audit (PM/ACC-206-READER-AUDIT-2026-11-11.md), never read from an engine here.
 *    `total` is null where the chit carries no engine figure to compare; `taxable` is null where the owner's margin is unknown.
 */
const stamped = { stamps: { total_value: { from: 'money.total' } } };

const FIXTURES = [
  { id: 'counter-bill', column: 'counter bill 1,000 + 180 tax', detail_total: 1180, summary: Object.assign({ total_value: 1180, money: { taxable: 1000, tax: 180, total: 1180 } }, stamped), taxable: 1000, total: 1180 },
  { id: 'b2b-new', column: 'B2B invoice since 2 Nov (180 + 9)', detail_total: 189, summary: Object.assign({ total_value: 189, money: { taxable: 180, tax: 9, total: 189 } }, stamped), taxable: 180, total: 189 },
  { id: 'b2b-pre-2-nov', column: 'B2B invoice before 2 Nov (total_value is the route net)', detail_total: 180, summary: { total_value: 180, money: { taxable: 180, tax: 9, total: 189 } }, taxable: 180, total: 189 },
  { id: 'money-net-only', column: 'money block with net, no taxable', detail_total: 189, summary: { total_value: 189, money: { net: 180, total: 189 } }, taxable: 180, total: 189 },
  { id: 'pre-7-sep', column: 'before 7 Sep: total_value only, no money block', detail_total: 180, summary: { total_value: 180 }, taxable: null, total: 180, placed: 180 },
  { id: 'withheld', column: 'TR-6 operator copy (oversight)', detail_total: 189, summary: { oversight: true, total_value: 189, money: { taxable: 180, tax: 9, total: 189 } }, taxable: null, total: null, withheld: true },
  { id: 'no-money', column: 'a note: no money at all', detail_total: null, summary: {}, taxable: null, total: null },
  { id: 'credit-note', column: 'counter credit note (ACC-255: money null, negative sign)', detail_total: -1180, summary: { total_value: -1180, money: null }, taxable: null, total: -1180, placed: -1180 }
];

/**
 * The ORDER rows (ACC-206 C2, the critic's point): a bill whose engine invoice is stored beside the header copies. FIXTURES above hold no
 * business_json.invoice, so a swap of the pick order (invoice, then money, then total_value) could not be seen. `total` is the hand figure the
 * one pick answers; `business` is the business_json the row carries. Kept apart from FIXTURES so the margin test's per-id hand table is unchanged.
 */
const invoiceOf = (total) => ({ invoice: { ValDtls: { TotInvVal: total } } });
const INVOICE_FIXTURES = [
  { id: 'invoice-only', column: 'invoice 189, no header money', summary: {}, business: invoiceOf(189), total: 189 },
  { id: 'invoice-equals-money', column: 'invoice 189 = money 189 = total_value 189 (stamped)', summary: Object.assign({ total_value: 189, money: { taxable: 180, tax: 9, total: 189 } }, stamped), business: invoiceOf(189), total: 189 },
  { id: 'invoice-differs-money', column: 'stamped mismatch (agree false): invoice 189, money 180, total_value 180', summary: Object.assign({ total_value: 180, money: { total: 180 } }, stamped), business: invoiceOf(189), total: 189 },
  { id: 'invoice-beats-money', column: 'order: invoice 200 over money 189 over total_value 150', summary: { total_value: 150, money: { total: 189 } }, business: invoiceOf(200), total: 200 },
  { id: 'money-zero', column: 'money.total 0 is a figure, not a gap (total_value 50)', summary: { total_value: 50, money: { total: 0 } }, business: null, total: 0 },
  { id: 'money-string', column: 'money.total "189.00" (a plain decimal string)', summary: { total_value: 180, money: { total: '189.00' } }, business: null, total: 189 },
  { id: 'junk-figure', column: 'total_value "x" and no money: not a number, no cast error', summary: { total_value: 'x' }, business: null, total: null },
  { id: 'withheld-with-invoice', column: 'TR-6 copy that still holds an invoice: no figure', summary: { oversight: true, total_value: 189 }, business: invoiceOf(189), total: null }
];

module.exports = { FIXTURES, INVOICE_FIXTURES };
