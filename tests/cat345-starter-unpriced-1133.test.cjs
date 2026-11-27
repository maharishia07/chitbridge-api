/**
 * tests/cat345-starter-unpriced-1133.test.cjs — CAT-345 guard: EVERY starter list, minted for a shop outside India, carries no price.
 * @type regression
 * OWNS      the proof, on lib/catalogue-blueprint, that mintPlan(key, [], { country }) for AU, AE, no country and an unknown country gives rows with no price,
 *           no MRP, no India picture and no India tax figure, for EVERY key of BLUEPRINTS (iterated, so a list added later cannot leak); that India keeps its list
 *           as it is; and that the constants are never mutated.
 * CALLED BY the api test run. No browser, no database.   node tests/cat345-starter-unpriced-1133.test.cjs
 */
'use strict';
const BP = require('../lib/catalogue-blueprint');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + info : '')); } };
const HOME_ONLY = ['price', 'mrp', 'image', 'hsn', 'gst_rate'];
const before = JSON.stringify(BP.BLUEPRINTS);
const keys = Object.keys(BP.BLUEPRINTS);
ok('there are starter lists to check', keys.length >= 6, keys.join(','));

for (const country of ['AU', 'AE', '', 'SG']) {
  for (const key of keys) {
    const plan = BP.mintPlan(key, [], { country });
    const leaking = plan.items.filter((item) => HOME_ONLY.some((field) => item[field] !== undefined && item[field] !== null));
    ok(key + ' for ' + JSON.stringify(country) + ': ' + plan.items.length + ' rows, none with a price, MRP, India picture or tax figure', plan.items.length > 0 && leaking.length === 0,
      leaking.slice(0, 3).map((item) => item.name + ' ' + JSON.stringify(HOME_ONLY.filter((field) => item[field] != null))).join(' | '));
    const shown = BP.localised(key, country);
    ok('  …and the list as shown has the same rows, unpriced', shown.starter.length > 0 && shown.starter.every((row) => row.price === undefined));
  }
}
for (const key of keys) {
  const india = BP.mintPlan(key, [], { country: 'IN' }).items;
  ok(key + ' for IN keeps its figures', india.every((item) => item.price !== undefined && item.price !== null));
}
ok('the constants are never mutated', JSON.stringify(BP.BLUEPRINTS) === before);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
