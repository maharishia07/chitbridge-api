/**
 * tests/supply-kind-export.test.cjs — A SALE THAT STATES IT IS AN EXPORT LANDS ON THE EXPORT LEDGER (walk G-F-01, P1; AE and AU).
 *
 * OWNS      the proof that books-hooks byRateOf reads the engine's own `_cb.export === 'stated'` (one decision, tax.determine isExport) and names kind 'export' on a charged-nothing line that
 *           named no kind, so posting lands it on sales_export (UAE 4020 -> VAT 201 Box 4; AU 4010 -> BAS G2), never on sales 4000 / Box 1. A taxed line, a line with its own kind and a sale
 *           that did not state an export are unchanged; a buyer's foreign address alone never makes an export (R6-01).
 * CALLED BY scripts/guards.cjs · CI. No database, no browser. Run: CB_ENGINES_DIR=../chitbridge-engines node tests/supply-kind-export.test.cjs
 * Hand figures (AED, the walk's bill E): export 250.50 -> 25050 fils on 4020, VAT 0; with a standard bill 105.00 incl. 5% (taxable 100.00, VAT 5.00) Box 1 = 10000 fils, Box 4 = 25050 fils.
 */
'use strict';
const path = require('path'), fs = require('fs');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'tax-slab.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const COUNTRY = require('../lib/country'), ENGINE_COUNTRY = require(path.join(engines, 'country'));
COUNTRY.packFor = ENGINE_COUNTRY.packFor;
const TL = require('../lib/tax-lines'), H = require('../lib/books-hooks');
const R = require(path.join(engines, 'regulation')), { makePost } = require(path.join(engines, '..', 'tests', 'helpers', 'books.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); process.exitCode = 1; } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const invoice = (country, currency, line, exportStated) => TL.invoiceFor({ lines: [line], seller: { country, reg: 'regular', tax_id: country === 'AE' ? '100000000000003' : '51824753556' }, buyer: { country: 'IN' }, currency, at: '2026-11-10', is_export: exportStated, priceIncludesTax: false }).invoice;
const credits = (country, rows, currency) => {
  const post = makePost('E', 0, { pack: R.packFor(country) });
  const lines = post({ type: 'walkin_day', ref: 'D', date: '2026-11-10', modes: { cash: 0 }, by_rate: rows });
  return lines.filter((l) => (l.cr_minor || 0) > 0).map((l) => (l.code || l.account) + ':' + l.cr_minor);
};

console.log('\n== AE: the walk bill E (250.50, buyer in India, VAT 0, is_export true) ==\n');
const ae = invoice('AE', 'AED', { name: 'Tea', qty: 1, price: 250.5, gst_rate: 0 }, true);
const rows = H.byRateOf(ae).rows;
eq('one row, rate 0, kind export, taxable 250.50', rows.map((r) => [r.rate, r.kind, r.taxable]), [[0, 'export', 250.5]]);
const cr = (rowsIn) => { const p = makePost('E', 0, { pack: R.packFor('AE') }); return p({ type: 'walkin_day', ref: 'D', date: '2026-11-10', modes: { cash: 250.5 }, by_rate: rowsIn }).filter((l) => l.cr_minor > 0).map((l) => (l.code || l.account) + ':' + l.cr_minor); };
eq('posts 25050 fils to 4020 Export sales, nothing to 4000', cr(rows), ['4020:25050']);
const VAT = require(path.join(engines, 'reg-ae'));
const box = VAT.returns.vat201({ period: '2026-11' }, [{ role: 'sales', dr_minor: 0, cr_minor: 10000 }, { role: 'output_vat', dr_minor: 0, cr_minor: 500 }, { role: 'sales_export', dr_minor: 0, cr_minor: 25050 }]);
const b = (n) => box.boxes[n];
ok('hand figures: Box 1 taxable 10000, Box 4 25050 (the engine reads the posted roles)', b(1).amount_minor === 10000 && b(4).amount_minor === 25050, JSON.stringify([b(1), b(4)]));

console.log('\n== what must NOT change ==\n');
const notStated = H.byRateOf(invoice('AE', 'AED', { name: 'Tea', qty: 1, price: 250.5, gst_rate: 0 }, undefined)).rows;
eq('a foreign buyer with no statement of export: no kind (R6-01), as before', notStated.map((r) => 'kind' in r), [false]);
const taxed = H.byRateOf(invoice('AE', 'AED', { name: 'Tea', qty: 1, price: 100, gst_rate: 5 }, false)).rows;
eq('a taxed domestic-style line (export said false) keeps no kind: 100.00 at 5%', taxed.map((r) => [r.rate, 'kind' in r, r.taxable]), [[5, false, 100]]);
const own = H.byRateOf(invoice('AE', 'AED', { name: 'Tea', qty: 1, price: 50, gst_rate: 0, tax_kind: 'exempt' }, true)).rows;
eq('a line with its own kind keeps it even when the sale states an export', own.map((r) => r.kind), ['exempt']);

console.log('\n== AU: an export is GST-free and lands on 4010 (BAS G2) ==\n');
const au = invoice('AU', 'AUD', { name: 'Wool', qty: 1, price: 300, gst_rate: 0 }, true);
const aurows = H.byRateOf(au).rows;
eq('kind export, taxable 300.00', aurows.map((r) => [r.kind, r.taxable]), [['export', 300]]);
const pa = makePost('E', 0, { pack: R.packFor('AU') });
eq('posts 30000 cents to 4010 Export sales (GST-free)', pa({ type: 'walkin_day', ref: 'D', date: '2026-11-10', modes: { cash: 300 }, by_rate: aurows }).filter((l) => l.cr_minor > 0).map((l) => (l.code || l.account) + ':' + l.cr_minor), ['4010:30000']);
console.log('\n' + pass + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
