'use strict';
// CARD      docs/06-catalogue-pim/functions/reference-lists-and-adopt-a-list.md
/**
 * walkh-list-country.test.cjs — WALK-H H-F-03: an AU shop is not offered India's shelves, and fresh food adopts GST-free from the AU pack's own table.
 * R1 an AU card drops 'Pooja & flowers' and 'Gourds' (rows, categories, count); an IN card and a no-country card are untouched
 * R2 an AU adopt of a Tomato (Vegetables) carries tax_kind gst_free and the pack's rate 0 (reg-au supplyKinds.gst_free); a flower stays with no kind
 * R3 an IN or unstated country adopts with no kind added (the pack names none for it)
 * R4 Home's Operations card for a shop that keeps no stock (holds-stock false): no below-zero line, figures.holds_stock false
 * Run: node tests/walkh-list-country.test.cjs · no DB, no network.   CARD 06-catalogue-pim/README
 */
const assert = require('assert');
const path = require('path');
const API = path.join(__dirname, '..');
const BP = require(path.join(API, 'lib', 'catalogue-blueprint'));
const R = require(path.join(API, 'lib', 'reference-store-lists'));
const L = require(path.join(API, 'lib', 'products-list-adopt'));
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.message).slice(0, 300)); } };
const card = R.cardOf(BP, 'veg', undefined);

ok('R1 an AU card drops the India-only shelves', () => {
  const au = L.cardForCountry(card, 'AU');
  assert.ok(card.rows.some((r) => r.category === 'Pooja & flowers'), 'the starter has them');
  assert.ok(!au.rows.some((r) => L.INDIA_ONLY_SHELVES.indexOf(r.category) >= 0));
  assert.ok(!au.categories.includes('Pooja & flowers') && !au.categories.includes('Gourds'));
  assert.strictEqual(au.count, au.rows.length);
  assert.strictEqual(L.cardForCountry(card, 'IN'), card);
  assert.strictEqual(L.cardForCountry(card, null), card);
});
ok('R2 AU fresh food is gst_free at the pack rate; a flower is not', () => {
  const out = L.withPackTaxKind([{ name: 'Tomato', categoryName: 'Vegetables' }, { name: 'Tulsi', categoryName: 'Pooja & flowers' }], 'AU');
  assert.strictEqual(out[0].tax_kind, 'gst_free');
  assert.strictEqual(out[0].gst_rate, 0);
  assert.strictEqual(out[1].tax_kind, undefined);
});
ok('R3 India / no country: no kind added', () => {
  const rows = [{ name: 'Tomato', categoryName: 'Vegetables' }];
  assert.deepStrictEqual(L.withPackTaxKind(rows, 'IN'), rows);
  assert.deepStrictEqual(L.withPackTaxKind(rows, null), rows);
});
(async () => {
  const hsPath = require.resolve(path.join(API, 'lib', 'holds-stock'));
  const schemaPath = require.resolve(path.join(API, 'lib', 'schema'));
  require.cache[hsPath] = { id: hsPath, filename: hsPath, loaded: true, exports: { holdsStockOf: async () => false } };
  require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true, exports: { hasTable: async () => true } };
  const HF = require(path.join(API, 'lib', 'home-facts'));
  try {
    const card = await HF.BUILD.operations({ entity: 'e1' });
    assert.strictEqual(card.figures.below_zero, 0);
    assert.strictEqual(card.figures.holds_stock, false);
    assert.ok(!card.lines.some((l) => /below zero/.test(l.text)));
    pass++; console.log('  ✓ R4 a shop that keeps no stock: no below-zero line, said in words');
  } catch (e) { fail++; console.log('  ✗ R4 ' + String(e.message).slice(0, 300)); }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
