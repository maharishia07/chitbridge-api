'use strict';
// @type: unit
/**
 * retest-1130-supply-kind.test.cjs — CARD qa/offline-guards (retest 1130, lane retest1129b): AJ-F-01 (AE walk AJ, P1): a supply kind carried by the line word `supply_kind`
 * was ignored silently and an unknown kind was accepted 200 with no warning, so a zero-rated line was taxed 5%.
 *
 * OWNS      the proof of the fix 39b595553 (lib/tax-lines.invoiceFor reads the line word supply_kind as the engine does) and of the refusal that stops an unknown kind
 *           (lib/supply-kind.refusalOf, one spelling for the line word, the catalogue word and _cb.kinds)
 * CALLED BY scripts/guards-list-3.cjs (scripts/guards.cjs) · CI. No database. Needs the engines checkout (skips without it, like tests/supply-kind-1128.test.cjs).
 * FLOW      lib/country packFor from the engines → invoiceFor / refusalOf → asserts. Hand figures AED: 100.00 at a stated 5% named zero-rated → tax 0.00 (was 5.00).
 */
const path = require('path'), fs = require('fs'), assert = require('assert');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'tax-slab.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const COUNTRY = require('../lib/country'); COUNTRY.packFor = require(path.join(engines, 'country')).packFor;
const TL = require('../lib/tax-lines'), SK = require('../lib/supply-kind');
let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; console.log('  ok   ' + name); };
const inv = (extra) => TL.invoiceFor({ lines: [Object.assign({ name: 'Tea', qty: 1, price: 100, gst_rate: 5 }, extra)], seller: { country: 'AE', reg: 'regular', tax_id: '100000000000003' }, buyer: { country: 'AE' }, currency: 'AED', at: '2026-11-10', priceIncludesTax: false }).invoice;
ok('AJ-F-01 a line that names supply_kind zero_rated is taxed 0.00 (was 5.00)', inv({ supply_kind: 'zero_rated' }).ItemList[0].TaxAmt === 0);
ok('AJ-F-01 the same through tax_kind, and an unnamed line is taxed 5.00', inv({ tax_kind: 'zero_rated' }).ItemList[0].TaxAmt === 0 && inv({}).ItemList[0].TaxAmt === 5);
const refuse = (item, cb) => SK.refusalOf({ country: 'AE', business_json: { invoice: Object.assign({ ItemList: [item] }, cb ? { _cb: cb } : {}) } });
ok('AJ-F-01 an unknown kind in the line word supply_kind is refused naming the line and the kinds', (() => { const r = refuse({ supply_kind: 'nonsense' }); return r && r.line === 1 && r.kind === 'nonsense' && r.kinds.indexOf('zero_rated') >= 0; })());
ok('AJ-F-01 an unknown kind in the catalogue word tax_kind and in _cb.kinds is refused too', !!refuse({ tax_kind: 'nonsense' }) && !!refuse({}, { kinds: [{ line: 0, kind: 'nonsense' }] }));
ok('AJ-F-01 a known kind (any spelling dash/case) is not refused', refuse({ supply_kind: 'Zero-Rated' }) === null && refuse({ supply_kind: 'exempt' }) === null);
console.log(n + ' checks');
