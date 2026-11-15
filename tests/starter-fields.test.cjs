'use strict';
// @type: unit
/**
 * tests/starter-fields.test.cjs - the standard column set a trade starts from (lib/starter-fields.js, behind GET/POST /api/products/starter-columns).
 *
 * OWNS      the proof of what starterFor(vertical) hands the schema seeder: BASE plus the trade's own fields in one running display_order,
 *           a trade that relabels a BASE field REPLACES it (one `name`, never two), customer/compute legs never become product columns,
 *           an unknown trade answers the base set with vertical null (the route turns that into 400), and the picker list counts the fields.
 * CALLED BY scripts/guards.cjs (offline; no database, no network).
 * CARD      docs/19-onboarding-and-shop-setup/functions/starter-catalogue-and-seeds.md
 * Expectations are hand-counted from lib/starter-fields.js: BASE has 5 fields (name, unit, price, code, desc); `gold` adds fineness, assay_cert, bar_serial, hs_code (4);
 * `service` adds name (relabelled "Service"), skill, min_charge, estimate_req, sla_hours, sac_code (6, one of them a BASE key).
 */
const assert = require('assert');
const S = require('../lib/starter-fields');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  PASS  ' + name); pass++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; } };
const keys = (set) => set.fields.map((f) => f.field_key);

t('gold = the 5 base fields then its 4 own, display_order 1..9 with no gap', () => {
  const g = S.starterFor('gold');
  assert.deepStrictEqual(keys(g), ['name', 'unit', 'price', 'code', 'desc', 'fineness', 'assay_cert', 'bar_serial', 'hs_code']);
  assert.deepStrictEqual(g.fields.map((f) => f.display_order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.strictEqual(g.vertical, 'gold');
});
t('the vertical name is trimmed and lower-cased before the look-up', () => {
  assert.deepStrictEqual(keys(S.starterFor('  GOLD ')), keys(S.starterFor('gold')));
  assert.strictEqual(S.starterFor('  GOLD ').vertical, 'gold');
});
t('service RELABELS the base `name` (one field, label Service) instead of adding a second one', () => {
  const s = S.starterFor('service');
  assert.strictEqual(keys(s).filter((k) => k === 'name').length, 1);
  assert.strictEqual(s.fields.find((f) => f.field_key === 'name').field_name, 'Service');
  assert.strictEqual(s.fields.length, 10, '5 base + 6 own - the 1 shared key');
  assert.strictEqual(s.fields[0].field_key, 'name', 'the relabelled field keeps its base position');
});
t('the relabelled field keeps the base facts it did not restate (required stays true)', () => {
  assert.strictEqual(S.starterFor('service').fields[0].required, true);
  assert.strictEqual(S.starterFor('gold').fields.find((f) => f.field_key === 'fineness').required, false);
});
t('an unknown, empty or missing trade answers the 5 base fields, title General, unit piece, vertical null', () => {
  for (const v of ['zzz', '', undefined, null]) {
    const s = S.starterFor(v);
    assert.strictEqual(s.vertical, null); assert.strictEqual(s.title, 'General'); assert.strictEqual(s.unit, 'piece');
    assert.deepStrictEqual(keys(s), ['name', 'unit', 'price', 'code', 'desc']);
  }
});
t('a customer or compute leg never becomes a product column (the filter is applied to every trade)', () => {
  assert.deepStrictEqual(S.NOT_PRODUCT_LEGS, ['customer', 'compute']);
  for (const v of Object.keys(S.VERTICALS)) assert.ok(S.starterFor(v).fields.every((f) => !S.NOT_PRODUCT_LEGS.includes(f.leg)), v);
});
t('the picker lists the 8 trades with the title and the unit of each', () => {
  const l = S.list();
  assert.deepStrictEqual(l.map((x) => x.key), ['gold', 'coffee', 'pharma', 'paint', 'veg', 'retail', 'trade', 'service']);
  assert.strictEqual(l[0].title, 'Gold / bullion'); assert.strictEqual(l[0].unit, 'g');
});
t('the picker count equals the fields starterFor delivers, for every trade that relabels nothing', () => {
  for (const x of S.list()) if (x.key !== 'service') assert.strictEqual(x.field_count, S.starterFor(x.key).fields.length, x.key);
  assert.strictEqual(S.list()[0].field_count, 9);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
