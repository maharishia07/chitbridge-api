'use strict';
// CARD      docs/06-catalogue-pim/functions/reference-lists-and-adopt-a-list.md
/**
 * walkx-sample-country.test.cjs — WALK-X X-F-01: a UAE (and AU) shop's starter lists hold no India shelf or India-only item.
 * R1 for AE and AU, every blueprint card (the way the route builds it: localised then cardForCountry) has no Pooja / Gourds shelf and no 'Sambar cut' row
 * R2 an IN shop and a no-country shop still see the whole veg list
 * Run: node tests/walkx-sample-country.test.cjs · no DB, no network.
 */
const assert = require('assert');
const path = require('path');
const API = path.join(__dirname, '..');
const BP = require(path.join(API, 'lib', 'catalogue-blueprint'));
const R = require(path.join(API, 'lib', 'reference-store-lists'));
const L = require(path.join(API, 'lib', 'products-list-adopt'));
const cardFor = (key, cc) => L.cardForCountry(R.cardOf(Object.assign({}, BP, { blueprint: (k) => BP.localised(k, cc) }), key, undefined), cc);
const INDIA = /Pooja|Gourd|Sambar|Coimbatore|Erode|Salem|Chennai|Tiffin|Dosa|Idli/i;
let fail = 0;
const ok = (name, fn) => { try { fn(); console.log('  ok ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + String(e.message).slice(0, 300)); } };
['AE', 'AU'].forEach((cc) => ok('R1 ' + cc + ': no blueprint card shows an India shelf or item', () => {
  Object.keys(BP.BLUEPRINTS).forEach((key) => {
    const card = cardFor(key, cc);
    const bad = card.categories.concat(card.rows.map((r) => r.name)).filter((s) => INDIA.test(String(s)));
    assert.deepStrictEqual(bad, [], key + ' shows ' + bad.join(', '));
  });
}));
ok('R2 an IN shop and a no-country shop keep the whole veg list', () => {
  const inCard = cardFor('veg', 'IN');
  assert.ok(inCard.rows.some((r) => r.name === 'Sambar cut') && inCard.categories.includes('Pooja & flowers'));
  assert.ok(cardFor('veg', null).rows.some((r) => r.name === 'Sambar cut'));
});
process.exit(fail ? 1 : 0);
