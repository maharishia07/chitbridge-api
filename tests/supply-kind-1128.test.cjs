/**
 * tests/supply-kind-1128.test.cjs — THE SMALL SUPPLY-KIND FINDINGS OF WALK G (G-F-02 compute word, G-F-08 net of a VAT shop). Batch 1128, AE.
 *
 * OWNS      G-F-02: lib/tax-lines.invoiceFor reads a line's `supply_kind` as the engine does (tax.js:782), so POST /api/tax/compute is not blind to it;
 *           G-F-08: lib/tax-lines.ledger's `net` carries the one head of a non-GST scheme (vat), so net.total = output VAT - input VAT, the figure the return shows.
 * CALLED BY scripts/guards.cjs · CI. No database, no browser. Run: CB_ENGINES_DIR=../chitbridge-engines node tests/supply-kind-1128.test.cjs
 * Hand figures (AED): G-F-02 100.00 at a stated 5% named zero-rated -> tax 0.00 (was 5.00).  G-F-08 sold 1,000.00 + 5% = 50.00 output; bought 400.00 + 5% = 20.00 input; net 30.00 (was 0).
 */
'use strict';
const path = require('path'), fs = require('fs');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'tax-slab.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const COUNTRY = require('../lib/country'), ENGINE_COUNTRY = require(path.join(engines, 'country'));
COUNTRY.packFor = ENGINE_COUNTRY.packFor;
const TL = require('../lib/tax-lines');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); process.exitCode = 1; } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const sale = (extra) => TL.invoiceFor({ lines: [Object.assign({ name: 'Tea', qty: 1, price: 100, gst_rate: 5 }, extra)], seller: { country: 'AE', reg: 'regular', tax_id: '100000000000003' }, buyer: { country: 'AE' }, currency: 'AED', at: '2026-11-10', priceIncludesTax: false }).invoice;

console.log('\n== G-F-02: the line word supply_kind reaches the engine ==\n');
eq('a line named supply_kind zero_rated at 5% is taxed 0.00', sale({ supply_kind: 'zero_rated' }).ItemList[0].TaxAmt, 0);
eq('and says so in _cb.kinds (kind, box 4)', (sale({ supply_kind: 'zero_rated' })._cb.kinds || []).map((k) => [k.kind, k.box]), [['zero_rated', '4']]);
eq('tax_kind (the catalogue word) still does the same', sale({ tax_kind: 'zero_rated' }).ItemList[0].TaxAmt, 0);
eq('a line that names no kind is taxed 5.00 as before', sale({}).ItemList[0].TaxAmt, 5);
eq('exempt by supply_kind: 0.00, box 5', [sale({ supply_kind: 'exempt' }).ItemList[0].TaxAmt, sale({ supply_kind: 'exempt' })._cb.kinds[0].box], [0, '5']);

console.log('\n== G-F-08: net carries the VAT head ==\n');
const me = TL.partyOf({ country: 'AE', reg: 'regular', tax_id: '100000000000003' });
const entry = (direction, price, extra) => Object.assign({ chit_id: direction + price, direction, invoice: TL.invoiceFor({ lines: [{ name: 'x', qty: 1, price, gst_rate: 5 }], seller: { country: 'AE', reg: 'regular', tax_id: direction === 'sent' ? '100000000000003' : '100000000000011' }, buyer: { country: 'AE', reg: 'regular', tax_id: direction === 'sent' ? '100000000000011' : '100000000000003' }, currency: 'AED', at: '2026-11-10', priceIncludesTax: false }).invoice, seller: { RegType: 'regular' }, buyer: {}, at: '2026-11-10' }, extra);
const led = TL.ledger([entry('sent', 1000), entry('received', 400)], me);
eq('output VAT 50.00, input VAT 20.00', [led.output.vat, led.itc.vat], [50, 20]);
eq('net.vat 30.00 and net.total 30.00 (was 0)', [led.net.vat, led.net.total], [30, 30]);
console.log('\n' + pass + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
