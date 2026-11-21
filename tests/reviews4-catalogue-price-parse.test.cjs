/**
 * reviews4-catalogue-price-parse.test.cjs — batch 1129, GF-catalogue-01 M13 + M14 (EL M11): the import price parser refuses garbled cells instead of reading
 * another number; the adopt route reads a blank price as no price, never 0. Run: node tests/reviews4-catalogue-price-parse.test.cjs (no DB).
 */
'use strict';
const assert = require('assert'), path = require('path'), fs = require('fs');
const API = path.join(__dirname, '..');
const bp = require(path.join(API, 'lib', 'catalogue-blueprint'));
const keys = Object.keys(bp.BLUEPRINTS || bp.LISTS || {});
let pass = 0, fail = 0;
const it = (n, f) => { try { f(); pass++; console.log('  ok  ' + n); } catch (e) { fail++; console.log('  XX  ' + n + ' — ' + e.message); } };
const key = (bp.keys && bp.keys()[0]) || keys[0];
const price = (cell) => { const r = bp.rowsToProducts([{ name: 'Tea', price: cell }], key, []); return r.products.length ? { ok: true, price: Number((r.products[0].price && r.products[0].price.amount) != null ? r.products[0].price.amount : r.products[0].price) } : { ok: false, why: JSON.stringify(r.refused) }; };
it('plain figures still import (1299.50, 1,299.50, 1,29,999, Rs. 40, ₹40/-)', () => {
  assert.deepStrictEqual([price('1299.50').price, price('1,299.50').price, price('1,29,999').price, price('Rs. 40').price, price('₹40/-').price], [1299.5, 1299.5, 129999, 40, 40]);
});
it('garbled cells are refused by row, never read as another number', () => {
  for (const cell of ['1.299,00', '2 x 40', '10 / 12', '1e3', '3 for 100', '12,34']) assert.strictEqual(price(cell).ok, false, cell + ' -> ' + JSON.stringify(price(cell)));
});
it('a blank or a word with no figure is still "no price"', () => { assert.strictEqual(price('').ok, false); assert.strictEqual(price('n/a').ok, false); });
it('M14 adopt: a blank price is null (no price), never Number("") = 0, and text is refused', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'adopt.js'), 'utf8');
  const m = src.match(/function adoptPrice[^]*?\n}\n/); assert.ok(m, 'adoptPrice missing');
  const adoptPrice = new Function(m[0] + '; return adoptPrice;')();
  assert.strictEqual(adoptPrice(''), null); assert.strictEqual(adoptPrice(undefined), null); assert.strictEqual(adoptPrice('  '), null);
  assert.strictEqual(adoptPrice('12.5'), 12.5); assert.strictEqual(adoptPrice(0), 0);
  assert.ok(Number.isNaN(adoptPrice('abc'))); assert.ok(Number.isNaN(adoptPrice(-3))); assert.ok(Number.isNaN(adoptPrice('1e3')));
  assert.ok(!/price: w\.price == null/.test(src));
});
console.log('\n' + (fail ? 'FAIL ' + fail + ', ' : 'ok ') + pass + ' passed'); process.exit(fail ? 1 : 0);
