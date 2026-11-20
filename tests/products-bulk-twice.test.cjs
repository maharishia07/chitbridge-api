/**
 * products-bulk-twice.test.cjs — VOLUME walk 20 Nov, BK-11: products/bulk run twice must not double the catalogue.
 * The same code (or sku, any case) already in the shop, or twice in one request, is skipped and listed, never added or changed; no code = added. Pure, no database.
 * CARD docs/06-catalogue-pim/functions/items-create-edit-bulk-status.md
 */
'use strict';
const assert = require('assert');
const { splitKnown } = require('../lib/catalogue-write');
const items = [{ name: 'A', code: 'x1' }, { name: 'B', sku: 'X2' }, { name: 'C' }, { name: 'C' }, { name: 'D', code: 'X1' }];
const first = splitKnown([], items);
assert.deepStrictEqual(first.fresh.map((i) => i.name), ['A', 'B', 'C', 'C'], 'first run: the repeat of x1 inside the request is skipped, no-code rows are added');
assert.deepStrictEqual(first.skipped.map((i) => [i.index, i.code]), [[4, 'X1']]);
const second = splitKnown(['x1', 'x2'], items); /* what the shop holds after the first run */
assert.deepStrictEqual(second.fresh.map((i) => i.name), ['C', 'C'], 'second run: every coded item is skipped');
assert.strictEqual(second.skipped.length, 3);
assert.deepStrictEqual(splitKnown(['x1'], [{ name: 'Q', code: 'x1' }]).fresh, [], 'all known: nothing to add');
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'products.js'), 'utf8');
assert.ok(/newItemsOnly\(entity_id, items\)/.test(src) && /items: fresh/.test(src), 'the route writes only the fresh items');
console.log('products-bulk-twice: ok');
