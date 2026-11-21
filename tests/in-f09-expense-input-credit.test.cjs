/**
 * tests/in-f09-expense-input-credit.test.cjs — IN-F-09 (walk IN 21 Nov): a bill from a registered supplier who is not on ChitBridge gives input credit through Pay expense.
 * Widens the AE-F-18 path (lib/books-manual-bill-tax.js expenseBillOf): the form asks the GST rate (the pack's menu in force) and the supplier's GSTIN; the tax engine splits by the two states.
 * Shop: the rig's India shop, GSTIN 33AAAAA0000A1Z5 (Tamil Nadu), regular, day 2026-10-10.
 * Hand figures (professional fees Rs 11,800.00 paid from bank, 18% included: 11,800 x 18 / 118 = 1,800.00, net 10,000.00):
 *   supplier in Tamil Nadu (33AAHCW2468J1Z1): Dr 6120 10,000.00 · Dr 2210 Input CGST 900.00 · Dr 2211 Input SGST 900.00 · Cr 1500 Bank 11,800.00
 *   supplier in Karnataka (29AABCN4321M1ZB):  Dr 6120 10,000.00 · Dr 2212 Input IGST 1,800.00 · Cr 1500 Bank 11,800.00
 *   5% on Rs 1,050.00: 1,050 x 5 / 105 = 50.00 -> net 1,000.00, CGST 25.00 + SGST 25.00
 * Run: node tests/in-f09-expense-input-credit.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * UNIT      lib/books-manual-bill-tax.js
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n== POST /api/books/events - an India expense with GST picked on the form ==\n');
  const R = await rig();
  if (!R) return;
  const { X, q } = R, T = X.T;
  const D = '2026-10-05';
  const setup = require('../lib/country-setup');
  let REG = 'regular';
  setup.registrationOfShop = async () => REG;
  setup.shopTaxNumber = async () => '33AAAAA0000A1Z5'; /* the in-memory store has no migrated country-setup row; the shop's number is the rig's */
  const entryOf = (ref) => T.entries.find((e) => e.source_ref === ref);
  const linesOf = (e) => T.lines.filter((l) => l.entry_id === e.entry_id).sort((a, b) => a.line_no - b.line_no).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const dr = (lines) => lines.filter((l) => l[1] > 0).map((l) => l[0] + ':' + l[1]).sort().join(' ');
  const post = (ref, extra) => q('POST', '/events', Object.assign({ kind: 'expense', class: 'professional', paid_from: 'bank', date: D, amount: 11800, client_ref: ref }, extra));

  const grid = await q('GET', '/events');
  const fields = ((grid.body.events || []).find((e) => e.kind === 'expense') || {}).fields || [];
  const rate = fields.find((f) => f.key === 'tax_rate'), gstin = fields.find((f) => f.key === 'supplier_gstin');
  ok('the grid offers the GST choice in the pack\'s word', !!rate && /GST/.test(rate.label), JSON.stringify(rate));
  const offered = (rate ? rate.options : []).map((o) => o.v).filter((v) => v !== '0').join(',');
  eq('the rates offered are the menu in force (IN-F-04): 0.25, 1.5, 3, 5, 18, 40; no 12 and no 28', offered, '0.25,1.5,3,5,18,40');
  ok('...and the supplier GSTIN', !!gstin && /GSTIN/.test(gstin.label), JSON.stringify(gstin));

  const intra = await post('i-1', { tax_rate: '18', supplier_gstin: '33AAHCW2468J1Z1' });
  ok('18% included, supplier in the shop state: posts (200)', intra.status === 200 && intra.body.ok, JSON.stringify(intra.body));
  const l1 = linesOf(entryOf('ev:expense:i-1'));
  eq('...Dr 6120 10,000.00 · Dr 2210 900.00 · Dr 2211 900.00', dr(l1), '2210:90000 2211:90000 6120:1000000');
  eq('...Cr 1500 Bank 11,800.00', l1.filter((l) => l[2] > 0).map((l) => l[0] + ':' + l[2]).join(' '), '1500:1180000');

  const inter = await post('i-2', { tax_rate: '18', supplier_gstin: '29AABCN4321M1ZB' });
  ok('18% included, supplier in another state: posts (200)', inter.status === 200 && inter.body.ok, JSON.stringify(inter.body));
  eq('...Dr 6120 10,000.00 · Dr 2212 Input IGST 1,800.00', dr(linesOf(entryOf('ev:expense:i-2'))), '2212:180000 6120:1000000');

  const five = await post('i-3', { tax_rate: '5', supplier_gstin: '33AAHCW2468J1Z1', amount: 1050 });
  eq('5% on 1,050.00: net 1,000.00, CGST 25.00 + SGST 25.00', dr(linesOf(entryOf('ev:expense:i-3'))), '2210:2500 2211:2500 6120:100000');

  const none = await post('i-0', {});
  eq('no rate: the whole 11,800.00 is the expense (as before)', dr(linesOf(entryOf('ev:expense:i-0'))), '6120:1180000');
  const old = await post('i-12', { tax_rate: '12', supplier_gstin: '33AAHCW2468J1Z1' });
  ok('12% (ended 22 Sep 2025) is refused in words, nothing posted', old.status >= 400 && !entryOf('ev:expense:i-12'), JSON.stringify(old.body));
  const noGstin = await post('i-4', { tax_rate: '18' });
  ok('no supplier GSTIN: asked, nothing posted', noGstin.status >= 400 && !entryOf('ev:expense:i-4'), JSON.stringify(noGstin.body));
  const bad = await post('i-5', { tax_rate: '18', supplier_gstin: '99ABCPK1234L1ZH' });
  ok('a supplier GSTIN that is not a state (99): refused in words, nothing posted', bad.status >= 400 && !entryOf('ev:expense:i-5') && /state|number/i.test(JSON.stringify(bad.body)), JSON.stringify(bad.body));
  REG = 'composition';
  const comp = await post('i-6', { tax_rate: '18', supplier_gstin: '33AAHCW2468J1Z1' });
  ok('a shop on the composition scheme claims no input tax: nothing posted', comp.status >= 400 && !entryOf('ev:expense:i-6'), JSON.stringify(comp.body));
  R.close();
  done();
})();
