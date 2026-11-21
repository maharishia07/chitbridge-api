'use strict';
/* WALK AE AE2-F-01 (21 Nov 2026): a catalogue-sourced line with no typed rate takes its scheme from the SHOP's country pack (tax-packs.packFor(country).scheme),
   never a literal 'GST'. Hand (walk AE basket, VAT 5% incl.): 111.40 -> 0.90 + 1.39 + 0.51 + 2.50 = 5.30. Run: node tests/walkae2-line-scheme.test.cjs */
const assert = require('assert'), path = require('path');
const L = require(path.join(__dirname, '..', 'lib', 'tax-lines'));
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const shelfOf = (country) => ({ items: [{ item_id: 'i1', item_data: { name: 'Tea', gst_rate: 5 } }], slabs: [], categories: [], face: {}, zone: { country, timezone: null } });
const line = [{ item_id: 'i1', name: 'Tea', qty: 1, unit_price: 100 }];
const AE = L.decorate(line, shelfOf('AE'))[0], IN = L.decorate(line, shelfOf('IN'))[0], AU = L.decorate(line, shelfOf('AU'))[0];
ok(AE.gst_rate === 5 && AE.tax_scheme === 'VAT', 'AE catalogue line: rate 5, scheme VAT (got ' + AE.tax_scheme + ')');
ok(IN.tax_scheme === 'GST', 'IN catalogue line still says GST');
ok(AU.tax_scheme === 'GST', 'AU catalogue line still says GST');
/* the engine bills the AE line as VAT: 111.40 basket */
const prices = [18.0, 27.8, 10.2, 55.4]; const rates = L.decorate(prices.map((p, i) => ({ item_id: 'i1', name: 'Tea', qty: 1, unit_price: p })), shelfOf('AE'));
ok(rates.every((r) => r.tax_scheme === 'VAT'), 'every line of the basket carries VAT');
console.log(n + ' passed');
