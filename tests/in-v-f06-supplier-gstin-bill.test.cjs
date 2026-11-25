/**
 * in-v-f06-supplier-gstin-bill.test.cjs — WALK V V-F-06 (P2): a typed bill's supplier GSTIN went unchecked ("XYZ123", a wrong check letter, state 99 = accepted, tax nil).
 * The ONE check is profile.taxIdRefusal (GSTN format: 2-digit state 01-38/97, PAN, entity, Z, mod-36 check character); the bill door now uses it too.
 * Hand: 1,000 + 18% from a valid inter-state supplier = IGST 180.00, bill 1,180.00; the bad numbers are refused in words and nothing is posted.
 * Run: node tests/in-v-f06-supplier-gstin-bill.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * UNIT      lib/books-manual-bill-tax.js
 */
'use strict';
const { rig, counter } = require('./support/books-manual-rig.cjs');
const { ok, done } = counter();
(async () => {
  const R = await rig();
  if (!R) return;
  const { q } = R;
  const D = '2026-10-05';
  const bill = (g) => ({ supplier_gstin: g, my_gstin: '29AABCV7001A1ZT', lines: [{ name: 'Repairs', qty: 1, unit_price: 1000, gst_rate: 18 }] });
  const prev = (g) => q('POST', '/preview', { event: { kind: 'expense', class: 'repairs', paid_from: 'cash', date: D, bill: bill(g) } });
  for (const [name, g] of [['junk XYZ123', 'XYZ123'], ['state 99', '99AABCM5555F1Z0'], ['bad check letter', '29AABCM5555F1Z0'], ['14 characters', '33AAHCW2468J1Z']]) {
    const r = await prev(g);
    ok(name + ' is refused (not 200), in words', (r.status >= 400 || r.body.ok === false) && /supplier/i.test(JSON.stringify(r.body)), r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
    const p = await q('POST', '/events', { event: { kind: 'expense', class: 'repairs', paid_from: 'cash', date: D, bill: bill(g), client_ref: 'v06-' + name.length } });
    ok(name + ' posts nothing', p.status >= 400, p.status + ' ' + JSON.stringify(p.body).slice(0, 200));
  }
  const good = await prev('33AAHCW2468J1Z1');
  ok('a valid supplier GSTIN still previews (200)', good.status === 200, good.status + ' ' + JSON.stringify(good.body).slice(0, 300));
  R.close();
  done();
})();
