/**
 * tests/till2-start-country-1128.test.cjs — batch 1128 fixTill2 item 2: the counter's starter mint (POST /api/till/catalogue) hands the shop's country to mintPlan,
 * so a non-India shop is never given the Chennai hotel list.
 * @type regression
 * OWNS      source pins on routes/till.js (catalogueStartPlan takes the country, mints through mintPlan with it, the route reads it from lib/shop-country),
 *           on routes/products.js (the same one helper, no second copy) and the outcome through lib/catalogue-blueprint (AU/none = no India word; IN = Chennai list).
 * CALLED BY the api test run. No browser, no database.
 *   node tests/till2-start-country-1128.test.cjs
 */
'use strict';
const fs = require('fs');
const BP = require('../lib/catalogue-blueprint');
let fail = 0;
const ok = (n, c) => { if (!c) fail++; console.log((c ? '   ok   ' : '   FAIL ') + n); };
const till = fs.readFileSync(__dirname + '/../routes/till.js', 'utf8');
const prod = fs.readFileSync(__dirname + '/../routes/products.js', 'utf8');
ok('catalogueStartPlan takes the shop country', /function catalogueStartPlan\(text, existing, country\)/.test(till));
ok('the starter mint goes through mintPlan with the country', /blueprints\.mintPlan\(blueprint\.key, existing, \{ country:/.test(till));
ok('the route reads the country from the one helper', /catalogueStartPlan\(text, await [^\n]*shop-country'\)\.shopCountryOf\(entity_id\)\)/.test(till));
ok('products.js uses the same helper, no local copy', /require\('\.\.\/lib\/shop-country'\)/.test(prod) && !/async function shopCountryOf/.test(prod));
const INDIA = /Chennai|Tiffin|Idli|Dosa|Pongal|Vada|Sambar/i;
const names = (cc) => BP.mintPlan('hotel', [], { country: cc }).items.map((i) => i.name + ' ' + (i.category || '')).join(' | ');
ok('AU shop: no India word in the minted hotel list', !INDIA.test(names('AU')));
ok('no stated country: no India word', !INDIA.test(names('')));
ok('IN shop: still the Chennai list', INDIA.test(names('IN')));
console.log(fail ? 'FAIL ' + fail : 'PASS');
process.exit(fail ? 1 : 0);
