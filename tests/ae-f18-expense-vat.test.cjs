/**
 * ae-f18-expense-vat.test.cjs — AE-F-18 (Walk AE 21 Nov): a registered UAE shop paying a bill with VAT picks "5% VAT included" and the supplier's TRN on Pay expense; the books post the input VAT.
 * Hand: AED 420.00 paid, 5% inside = net 400.00 + VAT 20.00 (420 x 5/105 = 20.00). Entry: Dr 6030 Rent 400.00 · Dr 2210 Input VAT 20.00 · Cr 1500 Bank 420.00 (VAT201 Box 9: 400.00 / 20.00).
 * Proves: the grid offers the VAT choice and the supplier TRN in the pack's word; the form's answer posts the three lines through the tax engine; no rate = the whole amount to the expense;
 * a rate the pack lacks, an unregistered shop and a missing supplier TRN are each refused in words, nothing posted.
 * Run: node tests/ae-f18-expense-vat.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * UNIT      lib/books-manual.js
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();
const AE = { country: 'AE', currency_code: 'AED', gstn: '100234567800003', timezone: 'Asia/Dubai', policy_flags: { gst_registration: 'regular' } };

(async () => {
  console.log('\n══ POST /api/books/events — a UAE expense with VAT picked on the form ══\n');
  const R = await rig(AE);
  if (!R) return;
  const { X, q } = R, T = X.T;
  const D = '2026-10-05';
  const setup = require('../lib/country-setup');
  let REG = 'regular';
  setup.registrationOfShop = async () => REG;
  const entryOf = (ref) => T.entries.find((e) => e.source_ref === ref);
  const linesOf = (e) => T.lines.filter((l) => l.entry_id === e.entry_id).sort((a, b) => a.line_no - b.line_no).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const post = (ref, extra) => q('POST', '/events', Object.assign({ kind: 'expense', class: 'rent', paid_from: 'bank', date: D, amount: 420, client_ref: ref }, extra));

  const grid = await q('GET', '/events');
  const fields = ((grid.body.events || []).find((e) => e.kind === 'expense') || {}).fields || [];
  const rate = fields.find((f) => f.key === 'tax_rate'), trn = fields.find((f) => f.key === 'supplier_gstin');
  ok('the grid offers the VAT choice in the pack\'s word', !!rate && /VAT/.test(rate.label) && rate.options.some((o) => o.v === '5' && /5% VAT/.test(o.l)), JSON.stringify(rate));
  ok('…and the supplier TRN', !!trn && /TRN/.test(trn.label), JSON.stringify(trn));

  const withVat = await post('v-1', { tax_rate: '5', supplier_gstin: '100345678900003' });
  ok('5% VAT included posts (200)', withVat.status === 200 && withVat.body.ok, JSON.stringify(withVat.body));
  const lines = linesOf(entryOf('ev:expense:v-1'));
  const input = lines.filter((l) => l[1] === 2000);
  eq('…Dr expense 400.00 · Dr input VAT 20.00 · Cr bank 420.00', lines.map((l) => [l[1], l[2]]).sort().join('|'), [[0, 42000], [2000, 0], [40000, 0]].sort().join('|'));
  ok('…the 20.00 is on the input VAT ledger', input.length === 1 && /^22/.test(input[0][0]), JSON.stringify(lines));
  const none = await post('v-0', {});
  eq('no rate: the whole 420.00 is the expense (as before)', linesOf(entryOf('ev:expense:v-0')).map((l) => [l[1], l[2]]).join('|'), [[42000, 0], [0, 42000]].join('|'));
  const bad = await post('v-bad', { tax_rate: '7', supplier_gstin: '100345678900003' });
  ok('a rate the pack does not have is refused in words', bad.status >= 400 && !entryOf('ev:expense:v-bad'), JSON.stringify(bad.body));
  const noTrn = await post('v-notrn', { tax_rate: '5' });
  ok('no supplier TRN: asked, nothing posted', noTrn.status >= 400 && !entryOf('ev:expense:v-notrn'), JSON.stringify(noTrn.body));
  REG = 'unregistered';
  const unreg = await post('v-unreg', { tax_rate: '5', supplier_gstin: '100345678900003' });
  ok('an unregistered shop claims no VAT: refused, nothing posted', unreg.status >= 400 && !entryOf('ev:expense:v-unreg'), JSON.stringify(unreg.body));
  R.close();
  done();
})();
