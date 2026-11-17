'use strict';
/* STD-MEASURE: the band maths of tools/sig-stars.cjs on known numbers. Run: node tests/sig-stars.test.cjs */
const assert = require('assert');
const { bandOf, rateShares, rateLow, rateHigh, countParams, UNIT_BANDS, SHARE_EDGES } = require('../tools/sig-stars.cjs');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
ok(bandOf(15, UNIT_BANDS.size) === 0 && bandOf(16, UNIT_BANDS.size) === 1 && bandOf(61, UNIT_BANDS.size) === 3, 'unit size bands: 15 low · 16 moderate · 61 very high');
ok(rateShares([0, 0, 0], SHARE_EDGES.size) === '++' && rateShares([60, 40, 20], SHARE_EDGES.size) === '--', 'no risky code earns ++, a lot earns --');
ok(rateLow(2.9, { '++': 3, '+': 5, o: 10, '-': 20 }) === '++' && rateLow(25, { '++': 3, '+': 5, o: 10, '-': 20 }) === '--', 'duplication: 2.9% is ++, 25% is --');
ok(rateHigh(0.6, { '++': 1, '+': 0.5, o: 0.25, '-': 0.1 }) === '+', 'test ratio 0.6 is +');
ok(countParams('(a, {b, c}, d)', 0) === 3 && countParams('()', 0) === 0 && countParams('x', 0) === 1, 'parameters: destructuring counts once');
console.log(n + ' passed');
