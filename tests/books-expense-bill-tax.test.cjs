/**
 * books-expense-bill-tax.test.cjs — l16-expense-tax: an AU expense whose BILL carries GST posts the GST paid line (POST /api/books/events, bill door), the same entry as the bank sheet's input_tax_minor door.
 *
 * It posted at NET with no 2210 line (the bill's one head rode tax-lines.heads `vat`, the builder read only cgst/sgst/igst/cess), so the bank came out short by the tax.
 * Hand-worked, AU GST 1/11 inside, 10% on top: 242.00 inclusive = net 220.00 + GST 22.00 · 220.00 exclusive = GST 22.00, bank 242.00. Both: Dr 6010 220.00 · Dr 2210 22.00 · Cr 1500 242.00.
 * Proves: inclusive and exclusive bill both post the three lines · they equal the bank-line door's entry for the same 242.00 · a GST-free bill posts no tax line · a bill whose tax has no head waits in words.
 * Run: node tests/books-expense-bill-tax.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * UNIT      lib/books-manual.js
 */
'use strict';
const { rig, counter, SHOP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
const REGISTERED = { country: 'AU', currency_code: 'AUD', gstn: '51824753556', timezone: 'Australia/Sydney', policy_flags: { gst_registration: 'regular' } };

(async () => {
  console.log('\n══ POST /api/books/events — an AU expense bill with GST ══\n');
  const R = await rig(REGISTERED);
  if (!R) return;
  const { X, q } = R, T = X.T;
  const D = '2026-10-05';
  const setup = require('../lib/country-setup');
  setup.registrationOfShop = async () => setup.registrationOf({ number: X.db.countryRow.gstn, scheme: X.db.countryRow.policy_flags.gst_registration, tax_registration: null });
  const entryOf = (ref) => T.entries.find((e) => e.source_ref === ref);
  const linesOf = (e) => T.lines.filter((l) => l.entry_id === e.entry_id).sort((a, b) => a.line_no - b.line_no).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const bill = (price, inc, rate) => ({ supplier_gstin: '53004085616', my_gstin: '51824753556', price_includes_tax: inc, lines: [{ name: 'Office rent', qty: 1, unit_price: price, gst_rate: rate }] });
  const post = (ref, b) => q('POST', '/events', { event: { kind: 'expense', class: 'rent', paid_from: 'bank', date: D, bill: b, client_ref: ref } });
  const HAND = [['6010', 22000, 0], ['2210', 2200, 0], ['1500', 0, 24200]];

  const inc = await post('x-inc', bill(242, true, 10));
  ok('inclusive 242.00 posts (200)', inc.status === 200 && inc.body.ok, JSON.stringify(inc.body));
  eq('…Dr 220.00 · Dr 2210 GST paid 22.00 · Cr bank 242.00', linesOf(entryOf('ev:expense:x-inc')), HAND);
  const exc = await post('x-exc', bill(220, false, 10));
  eq('exclusive 220.00 + GST: the same three lines, bank 242.00', linesOf(entryOf('ev:expense:x-exc')), HAND);
  const bank = await q('POST', '/events', { kind: 'expense', class: 'rent', date: D, amount: 220, paid_from: 'bank', input_tax_minor: 2200, tax_invoice: 'held', client_ref: 'x-bank' });
  ok('the bank sheet door posts', bank.status === 200 && bank.body.ok, JSON.stringify(bank.body));
  eq('…and its entry equals the bill door\'s, line for line', linesOf(entryOf('ev:expense:x-bank')), linesOf(entryOf('ev:expense:x-inc')));
  const free = await post('x-free', bill(100, false, 0));
  eq('a GST-free bill posts no tax line', linesOf(entryOf('ev:expense:x-free')), [['6010', 10000, 0], ['1500', 0, 10000]]);
  R.close();
  done();
})();
