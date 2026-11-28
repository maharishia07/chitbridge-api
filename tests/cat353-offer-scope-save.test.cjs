'use strict';
/**
 * cat353-offer-scope-save.test.cjs — CAT-353: an offer whose scope cannot be read is refused at save, in the one error shape.
 * OWNS: lib/definition-check.js missingValue (the offer branch) refusing a scope key outside applies_to, by the engine's own test (CBOffers.unreadableScope).
 * CALLED BY scripts/guards.cjs
 * BREAK CASE: POST /api/definitions {offer, percent_off, rules:{scope:'line', percent:10, item_ids:[juice]}} saved live, and the till took 10% off all four products.
 * Run: node tests/cat353-offer-scope-save.test.cjs
 */
const assert = require('node:assert');
const { missingValue } = require('../lib/definition-check');
let fail = 0;
function it(name, fn) { try { fn(); console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + String(e.message).split('\n')[0]); } }
const pct = (extra) => missingValue('offer', 'percent_off', Object.assign({ scope: 'line', percent: 10 }, extra));
it('the video shop request (top-level item_ids) is refused, naming the key', () => assert.match(pct({ item_ids: ['juice-1'] }), /item_ids/));
it('top-level category_ids, skus, category are refused too', () => ['category_ids', 'skus', 'category'].forEach((k) => assert.ok(pct({ [k]: ['x'] }), k)));
it('an applies_to with only keys nobody reads is refused', () => assert.ok(pct({ applies_to: { categories: ['drinks'] } })));
it('a product scope inside applies_to saves', () => assert.strictEqual(pct({ applies_to: { item_ids: ['juice-1'] } }), null));
it('a category scope inside applies_to saves', () => assert.strictEqual(pct({ applies_to: { category_ids: ['drinks'] } }), null));
it('no scope at all is the whole shop and saves', () => assert.strictEqual(pct({}), null));
it('an empty top-level list is no scope and saves', () => assert.strictEqual(pct({ item_ids: [] }), null));
it('a threshold offer with a top-level min_qty still saves', () => assert.strictEqual(missingValue('offer', 'threshold', { percent: 5, min_qty: 3 }), null));
it('only offers are asked: a tax row with category keeps saving', () => assert.strictEqual(missingValue('tax', null, { rate: 10, category: 'x' }), null));
console.log(fail ? fail + ' failed' : 'all passed');
process.exit(fail ? 1 : 0);
