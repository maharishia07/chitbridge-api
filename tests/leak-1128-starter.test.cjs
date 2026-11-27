/**
 * tests/leak-1128-starter.test.cjs — batch 1128 fixLeak: the hotel starter list shows no India word to a non-India shop.
 * @type regression
 * OWNS      the proof, on lib/catalogue-blueprint (localised · mintPlan with a country), that for AU, AE, no country and an unknown country the hotel list holds
 *           no India word (Tiffin · Idli · Dosa · Pongal · Chennai · Tamil · a rupee price) in its name, categories, rows or minted items; that India still gets the
 *           Chennai list unchanged; that the pin/key/units are kept so a mint reads the copy like the original; that the constant is never mutated; and that routes/products.js
 *           hands the shop's country to both the lists card and the adopt mint.
 * CALLED BY the api test run (npm test). No browser, no database.
 * FLOW      localised(key, cc) → leaves scanned → mintPlan(key, [], { country }) → items scanned
 *   node tests/leak-1128-starter.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BP = require('../lib/catalogue-blueprint');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + info : '')); } };
const INDIA = /Chennai|Tamil|Tiffin|Idli|Dosa|Vada|Pongal|Upma|Poori|Sambar|Curd rice|Lemon rice|₹|Rupee|INR/i;
const leaves = (v, out) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => leaves(x, out)); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => leaves(v[k], out)); return out; };
const before = JSON.stringify(BP.blueprint('hotel'));

for (const cc of ['AU', 'au', 'AE', '', null, undefined, 'SG']) {
  const bp = BP.localised('hotel', cc);
  const shown = { outcome: bp.outcome, label: bp.label, categories: bp.categories, rows: bp.starter.map((r) => [r.name, r.unit, r.category, r.price]) };
  const bad = leaves(shown, []).filter((x) => INDIA.test(x));
  ok('hotel list for country ' + JSON.stringify(cc) + ' holds no India word', bad.length === 0, bad.join(' | '));
  ok('  …and no price in it (the shop money is stamped on write)', bp.starter.every((r) => r.price === undefined));
  ok('  …and every row sits on one of its categories, with a counted unit', bp.starter.every((r) => bp.categories.includes(r.category) && bp.units.includes(r.unit)));
  if (cc === undefined) continue; /* no country asked = the caller's old behaviour, tested below */
  const plan = BP.mintPlan('hotel', [], { country: cc });
  const minted = leaves(plan.items.map((i) => [i.name, i.unit, i.categoryName]), []).filter((x) => INDIA.test(x));
  ok('  …and the adopt mint holds none either (' + plan.items.length + ' items)', plan.items.length > 5 && minted.length === 0, minted.join(' | '));
}
const au = BP.localised('hotel', 'AU');
ok('the copy keeps key · version · prefix · units (a pin and a mint read it like the original)', au.key === 'hotel' && au.version === 1 && au.prefix === 'H' && au.defaultUnit === 'plate' && BP.pin(au) === BP.pin(BP.blueprint('hotel')));
const india = BP.localised('hotel', 'IN');
ok('India still gets the Chennai list itself (same object, Idli at 40)', india === BP.blueprint('hotel') && india.starter[0].name === 'Idli' && india.starter[0].price === 40);
ok('the india list is also what mintPlan gives for IN', BP.mintPlan('hotel', [], { country: 'IN' }).items[0].name === 'Idli');
ok('a caller that passes no country keeps today’s behaviour (mintPlan unchanged)', BP.mintPlan('hotel', []).items[0].name === 'Idli');
ok('another list (veg) keeps its rows for any country, unpriced (CAT-345)', BP.localised('veg', 'AU') !== BP.blueprint('veg') && BP.localised('veg', 'AU').starter.length === BP.blueprint('veg').starter.length && BP.localised('veg', 'IN') === BP.blueprint('veg'));
ok('an unknown list stays the neutral general one', BP.localised('nope', 'AU').key === 'general');
ok('the constant is never mutated by any of the above', JSON.stringify(BP.blueprint('hotel')) === before);

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'products.js'), 'utf8');
ok('GET /lists builds its cards from BP.localised(key, country) and never the India store rows for another country', /BP\.localised\(key, country\)/.test(route) && /BP\.localised\(item, country\) === BP\.blueprint\(item\)/.test(route));
ok('POST /lists/adopt hands the shop country to the mint', /country: await shopCountryOf\(entity_id\)/.test(route));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
