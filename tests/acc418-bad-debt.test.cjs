/**
 * tests/acc418-bad-debt.test.cjs — ACC-418: lib/books-bad-debt reads the GST ACTUALLY charged on the invoice a write-off (or its recovery) names, from the invoice's own posted tax lines.
 * OWNS      the hand figures: invoice 90.00 + GST 9.00 = 99.00 → { gross 9900, tax 900 }; a mixed invoice 120.00 with GST 5.00 → { 12000, 500 } (never 1/11); no ref, a ref with no tax line, or a pack with no badDebt row leaves the event as it was
 * CALLED BY scripts/guards.cjs · CI. No database: a stand-in handle answers the one statement.
 * FLOW      (handle, entity, pack, event) → { event, note }
 * CARD      14-accounting/README
 * MIN unit-per-rule · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const bad = require('../lib/books-bad-debt');
let checks = 0;
const ok = (name, got, want) => { assert.deepStrictEqual(got, want, name); checks++; console.log('   ok   ' + name); };
const CHIT = '0a1b2c3d-0000-4000-8000-000000000001';
const handle = (rows) => ({ query: async () => ({ rows }) });
const PACK = { tax: { scheme: 'GST', badDebt: { head: 'gst' } }, taxLedgers: { gst: { output: 'gst_collected', input: 'gst_paid' } } };
const NO_ROW = { tax: {}, taxLedgers: PACK.taxLedgers };
(async () => {
  const h99 = handle([{ chit_id: CHIT, role: 'gst_collected', minor: '-900' }, { chit_id: CHIT, role: 'debtors', minor: '9900' }]);
  ok('invoice 90.00 + GST 9.00: gross 99.00, tax 9.00', await bad.invoiceOf(h99, 'E1', PACK, CHIT), { gross_minor: 9900, tax_minor: 900 });
  const mixed = handle([{ chit_id: CHIT, role: 'gst_collected', minor: '-500' }, { chit_id: CHIT, role: 'debtors', minor: '12000' }]);
  ok('mixed invoice 120.00 with GST 5.00: tax 5.00, not 1/11', await bad.invoiceOf(mixed, 'E1', PACK, CHIT), { gross_minor: 12000, tax_minor: 500 });
  const got = await bad.withInvoice(h99, 'E1', PACK, { type: 'write_off', against_ref: CHIT, amount: 99 });
  ok('the event gains invoice, no note', [got.event.invoice, got.note], [{ gross_minor: 9900, tax_minor: 900 }, null]);
  const none = await bad.withInvoice(handle([]), 'E1', PACK, { type: 'write_off', against_ref: CHIT, amount: 99 });
  ok('an invoice with no tax line: the event is as it was and the note says so', [none.event.invoice, /No GST was adjusted/.test(none.note)], [undefined, true]);
  const noRef = await bad.withInvoice(h99, 'E1', PACK, { type: 'write_off', amount: 99 });
  ok('no against_ref: nothing read, the note says so', [noRef.event.invoice, /name the invoice/.test(noRef.note)], [undefined, true]);
  const notId = await bad.invoiceOf(h99, 'E1', PACK, 'not-a-chit');
  ok('a ref that is not a chit id reads nothing', notId, null);
  const noRow = await bad.withInvoice(h99, 'E1', NO_ROW, { type: 'write_off', against_ref: CHIT, amount: 99 });
  ok('a pack without the badDebt row (IN, AE, AU 1.0.0): no read, no note, the event untouched', [noRow.event.invoice, noRow.note], [undefined, null]);
  const credit = handle([{ chit_id: CHIT, role: 'gst_collected', minor: '0' }, { chit_id: CHIT, role: 'debtors', minor: '0' }]);
  ok('a bill fully credit-noted (nets to nothing) reads as none', await bad.invoiceOf(credit, 'E1', PACK, CHIT), null);
  console.log('\n' + checks + ' checks');
})().catch((e) => { console.log('   FAIL ' + e.message); process.exit(1); });
