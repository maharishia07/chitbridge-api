/**
 * tests/till-catalogue-door-gstfree-1133.test.cjs — A GST-FREE ITEM SEEDED THROUGH POST /api/till/catalogue KEEPS ITS KIND (TILL-new-1, screen run 27 Nov 2026 on sit-au).
 *
 * OWNS      the proof that the catalogue door's row reader (lib/catalogue-blueprint.rowsToProducts, the ONE list of carried fields, CARRIED) carries `tax_kind` beside `gst_rate`,
 *           and that a product so seeded sells GST-free end to end: shelf -> counter-kinds.stamp -> tax-lines invoice -> books-hooks rows -> posting (4020, role sales_gst_free) -> BAS.
 *           Before the fix the door dropped `tax_kind` in silence (a whitelist), so the till asked "Say why ... GST 0%" and the sale could not finish.
 * CALLED BY scripts/guards.cjs · CI. No database, no browser. Run on sit-grund: CB_ENGINES_DIR=../chitbridge-engines node tests/till-catalogue-door-gstfree-1133.test.cjs
 * HAND FIGURES (AUD, prices include GST): Fresh bread 4.00 GST-free + Latte 11.00 taxable (GST 11.00/11 = 1.00, taxable 10.00) = 15.00.
 *           BAS: G1 1500 (total sales incl GST), G3 400 (GST-free sales), 1A 100. The bread posts no GST: 2200 carries 100 only.
 */
'use strict';
const path = require('path'), fs = require('fs');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'tax-slab.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const COUNTRY = require('../lib/country'), ENGINE_COUNTRY = require(path.join(engines, 'country'));
COUNTRY.packFor = ENGINE_COUNTRY.packFor;
const BP = require('../lib/catalogue-blueprint'), TL = require('../lib/tax-lines'), H = require('../lib/books-hooks'), CK = require('../lib/counter-kinds');
const R = require(path.join(engines, 'regulation')), { makePost } = require(path.join(engines, '..', 'tests', 'helpers', 'books.js'));
const GR = require(path.join(engines, 'gst-returns'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); process.exitCode = 1; } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

console.log('\n== the door: rows in the shape POST /api/till/catalogue { products } takes ==\n');
const seeded = BP.rowsToProducts([{ name: 'Fresh bread', price: 4, gst_rate: 0, tax_kind: 'gst_free' }, { name: 'Latte', price: 11, gst_rate: 10 }, { name: 'Plain', price: 3, gst_rate: 0 }], null, []);
eq('Fresh bread keeps tax_kind gst_free beside gst_rate 0 (the bug: tax_kind was dropped)', [seeded.products[0].gst_rate, seeded.products[0].tax_kind], [0, 'gst_free']);
eq('a 10% row and a bare 0% row carry no kind (never defaulted, never guessed)', [seeded.products[1].tax_kind, seeded.products[2].tax_kind], [undefined, undefined]);

console.log('\n== the sale: bread + latte on an AU registered shop ==\n');
const shelf = { items: seeded.products.slice(0, 2).map((p, i) => ({ item_id: 'i' + i, item_data: p })), slabs: [], categories: [], face: {} };
const lines = [{ item_id: 'i0', particulars: 'Fresh bread', quantity: 1, price: 4, gst_rate: 0 }, { item_id: 'i1', particulars: 'Latte', quantity: 1, price: 11, gst_rate: 10 }];
const asked = { lines, seller: { country: 'AU', reg: 'regular', tax_id: '18123456789' }, buyer: { country: 'AU' }, currency: 'AUD', at: '2026-11-27', priceIncludesTax: true };
const stamped = CK.stamp(lines, shelf);
eq('the shelf says gst_free for the bread; the latte stays plain', stamped.lines.map((l) => l.tax_kind || null), ['gst_free', null]);
const inv = TL.invoiceFor(Object.assign({}, asked, { lines: stamped.lines })).invoice;
const rows = H.byRateOf(inv, 'AUD').rows;
eq('the books read two rows: GST-free 4.00 and 10% taxable 10.00', rows.map((r) => [r.rate, r.kind || null, r.taxable]), [[0, 'gst_free', 4], [10, null, 10]]);
const posted = makePost('E', 0, { pack: R.packFor('AU') })({ type: 'walkin_day', ref: 'T', date: '2026-11-27', by_rate: rows, modes: { cash: 15 } });
const at = (code) => posted.filter((l) => String(l.code || l.account) === code).map((l) => (l.cr_minor || 0) - (l.dr_minor || 0));
eq('posts 4020 GST-free sales Cr 400 and GST (2200) Cr 100 only', [at('4020'), at('2200')], [[400], [100]]);
const ledgerRows = posted.map((l) => ({ code: String(l.code || l.account), role: l.role, dr_minor: l.dr_minor || 0, cr_minor: l.cr_minor || 0 })).filter((r) => r.role);
const bas = GR.returnFor(R.packFor('AU'), '2026-Q2', ledgerRows, { simpler: false });
const box = (c) => bas.boxes.find((b) => b.code === c).amount_minor;
eq('BAS Q2: G3 picks the bread up (400); 1A is the latte\'s GST alone (100); G1 1500', [box('G3'), box('1A'), box('G1')], [400, 100, 1500]);
console.log('\n' + pass + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
