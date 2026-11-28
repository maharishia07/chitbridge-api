'use strict';
/**
 * tests/till-day-tax-books-rc4.test.cjs — DRIFT RC4 (Athi 28 Nov 2026): the till's day-report Tax is the BOOKS' figure (the journal), never a sum of the counter's own bills' tax.
 * OWNS      (1) the pure choice dayRepTaxOf (books figure for today, else own sum labelled "not yet synced"), (2) the guard: dayReportHTML adds no bill tax into the headline without going through it,
 *           (3) the server's one reader (lib/till-summary dayTax) with the pack's OUTPUT tax roles, hand-computed per country.
 * MIN hand-computed: a 5%-rate day of two bills, 15.00 own tax; the books hold 14.99 (one cash-rounded credit note): the sheet says 14.99. Offline: 15.00 labelled.
 * MIN mutation: put the old reduce back (headline tax = sum of b.tax) and the guard fails; make dayRepTaxOf ignore the books figure and (1) fails.
 * Run: node tests/till-day-tax-books-rc4.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const KIT = path.join(__dirname, '..', 'tools', 'tally-connector');
let pass = 0, fail = 0;
const check = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };
const part = fs.readFileSync(path.join(KIT, 'till-dayrep.js'), 'utf8');
const page = fs.readFileSync(path.join(KIT, 'till.html'), 'utf8');
const ctx = vm.createContext({ esc: (s) => String(s), money: (n) => 'Rs ' + n, rmoney: (n) => Math.round(n * 100) / 100, r2: (n) => n, hhmm: () => '', bohniOf: () => null, schemeWord: () => 'GST', cbQuiet: () => {}, isReturnRow: () => false, window: {} });
vm.runInContext(part, ctx);

check('the books figure for TODAY is the sheet\'s tax: 14.99, no label', () => {
  const x = ctx.dayRepTaxOf({ day: '2026-11-28', tax: 14.99, currency: 'INR' }, 15, '2026-11-28');
  assert.strictEqual(x.tax, 14.99); assert.ok(/whole shop/.test(x.label));
});
check('no answer (offline, books off, old api): own sum 15.00, LABELLED "not yet synced"', () => {
  const x = ctx.dayRepTaxOf(null, 15, '2026-11-28');
  assert.strictEqual(x.tax, 15); assert.ok(/not yet synced/.test(x.label));
});
check('an answer for another day (the till sat open past midnight) is not used', () => {
  const x = ctx.dayRepTaxOf({ day: '2026-11-27', tax: 99, currency: 'INR' }, 15, '2026-11-28');
  assert.strictEqual(x.tax, 15); assert.ok(x.label);
});
check('the summary row carries the label when the figure is the counter\'s own', () => {
  const html = ctx.dayRepSummary({ bills: [], count: 1, qty: 1, total: 105, saved: 0, taxable: 100, tax: 5, taxLabel: 'Tax (this counter, not yet synced)' });
  assert.ok(html.indexOf('Tax (this counter, not yet synced)') > -1);
  assert.ok(ctx.dayRepSummary({ bills: [], count: 1, qty: 1, total: 105, saved: 0, taxable: 100, tax: 5, taxLabel: 'Tax (whole shop, all counters, from the books)' }).indexOf('not yet synced') < 0);
});
check('GUARD: dayReportHTML takes the headline tax from dayRepTaxOf, and the old reduce is only its fallback input', () => {
  const body = page.slice(page.indexOf('function dayReportHTML('), page.indexOf('function dayRepHead('));
  assert.ok(/dayRepTaxOf\(/.test(body), 'the headline tax must go through dayRepTaxOf');
  assert.ok(!/var tax = bills\.reduce/.test(body), 'the headline tax must not be a sum of the bills again');
  assert.ok(/tax: tax, taxLabel: taxSet\.label/.test(body), 'the summary must carry the label');
});
check('the cloud counter asks the server (GET /api/till/summary day_tax); the program\'s counter says null (labelled)', () => {
  assert.ok(/dayTax: async function\(\)[\s\S]{0,400}day_tax/.test(page));
  assert.ok(/dayTax: function\(\)\{ return Promise\.resolve\(null\); \}/.test(page));
});

/* the server's one reader */
const O = require('../lib/books-other-side');
const engines = require('../lib/books-engines').packs();
check('output tax roles per country, from the pack\'s own tax ledgers (hand list): AU 1, IN 4, AE 1', () => {
  assert.deepStrictEqual(O.outputRolesOf(engines.packFor('AU')), ['gst_collected']);
  assert.deepStrictEqual(O.outputRolesOf(engines.packFor('IN')), ['output_cgst', 'output_sgst', 'output_igst', 'output_cess']);
  assert.deepStrictEqual(O.outputRolesOf(engines.packFor('AE')), ['output_vat']);
  assert.deepStrictEqual(O.outputRolesOf(null), []);
});
check('soldEntriesSql reads tax_out on exactly those roles (and 0 when none asked); soldByDay answers tax null then', () => {
  const S = require('../lib/books-store');
  const on = S.soldEntriesSql('$1', { taxRoles: ['gst_collected'] }), off = S.soldEntriesSql('$1', {});
  assert.ok(/role = ANY\(ARRAY\['gst_collected'\]::text\[\]\)\), '\{\}'\) AS tax_ids/.test(on));
  assert.ok(/l\.cr_minor - l\.dr_minor ELSE 0 END\) AS tax_out/.test(on));
  assert.ok(/ARRAY\[''\]::text\[\]\)\), '\{\}'\) AS tax_ids/.test(off));
});
check('the route answers day_tax only for the day view, from the one reader', () => {
  const r = fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'latin1');
  assert.ok(/booksTax: period === 'day' \? await dayTaxOrNull/.test(r) && /answer\.day_tax = booksTax/.test(r));
  assert.ok(/dayTax,/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'till-summary.js'), 'utf8')));
});
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
