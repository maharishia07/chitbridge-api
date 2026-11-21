'use strict';
/**
 * reviews3-stock-value-unit.test.cjs — batch 1129 fixReviews3 (GF-orders-stock-01 M5, M6): inventory.apply.
 * BREAK CASE: a goods-in in 'kg' then a sale in 'Kg' was refused as two units; 1000 pieces at 0.333 were valued 330.00 not 333.00.
 * Run: node tests/reviews3-stock-value-unit.test.cjs
 */
const assert = require('node:assert');
const inv = require('../lib/inventory');
const buy = inv.apply({ qty: 0, value: 0 }, { item_id: 'p1', reason: 'purchase', qty: 1000, rate: 0.333, unit: 'pieces' });
assert.strictEqual(buy.ok, true, buy.why);
assert.strictEqual(buy.value, 333, 'value ' + buy.value);
const kg = inv.apply({ qty: 0, value: 0 }, { item_id: 'p2', reason: 'purchase', qty: 100, rate: 5, unit: 'kg' });
const sold = inv.apply({ qty: kg.qty, value: kg.value, avg_cost: kg.avg_cost, unit: kg.unit }, { item_id: 'p2', reason: 'sale', qty: 2, unit: 'Kg' });
assert.strictEqual(sold.ok, true, sold.why);
assert.strictEqual(sold.qty, 98);
const real = inv.apply({ qty: kg.qty, value: kg.value, avg_cost: kg.avg_cost, unit: kg.unit }, { item_id: 'p2', reason: 'sale', qty: 2, unit: 'box' });
assert.strictEqual(real.ok, false, 'a real unit change is still refused');
console.log('ok reviews3-stock-value-unit');
