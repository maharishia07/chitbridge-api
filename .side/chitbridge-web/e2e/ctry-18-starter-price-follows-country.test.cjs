/**
 * e2e/ctry-18-starter-price-follows-country.test.cjs — CTRY-18 (proof 2026-11-14): the Product Lab's suggested prices follow the shop's money.
 * @type regression
 * OWNS      the proof, on the REAL tableFits / suggestedOf / priceOf / localOf / unitLine from public/product-lab.html (lifted into a vm sandbox), that:
 *           an INR shop gets the starter table's price (Tomato kg 40 → "INR 40" tagged "suggested"); an AED shop gets a BLANK ("—", no "suggested" tag, no
 *           local-name words) — never "AED 40", the rupee number relabelled; a shop with no money (no country) gets blank too; a row the shop already sells
 *           shows THE SHOP'S price (AED 55 "yours") whatever the table says. Round 2 (a sourced price table per country) is Athi's call and not tested here.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 * FLOW      DATA.currency + a starter row → tableFits → suggestedOf / priceOf → unitLine HTML
 *   node e2e/ctry-18-starter-price-follows-country.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'product-lab.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 400) : '')); } };

const tableCurrency = (html.match(/^var TABLE_CURRENCY = '[A-Z]+';/m) || [''])[0];
const code = [tableCurrency, 'var SEP = String.fromCharCode(1);', liftFns('public/product-lab.html', ['keyOf', 'have', 'tableFits', 'suggestedOf', 'priceOf', 'localOf', 'unitLine'])].join('\n');
function world(data, langs) {
  const sb = { DATA: data, LANGS: langs || [], PICKED: {}, esc: (s) => String(s), fmtMoneyWhole: (n, cur, dash) => (n === null || n === undefined ? dash : cur + ' ' + n) };
  vm.createContext(sb); vm.runInContext(code, sb); return sb;
}
const tomatoKg = { name: 'Tomato', unit: 'kg', price: 40, names: { Tamil: ['தக்காளி'] } };
const mine = (price) => ({ [tomatoKg.name + String.fromCharCode(1) + tomatoKg.unit]: { price } });

let w = world({ currency: 'INR', _have: {}, _mine: {} }, ['Tamil']);
ok('INR shop: the table fits, the suggestion is the table\'s 40, tagged suggested', w.tableFits() === true && w.suggestedOf(tomatoKg) === 40 && JSON.stringify(w.priceOf(tomatoKg)) === '{"n":40,"whose":"suggested"}', JSON.stringify(w.priceOf(tomatoKg)));
ok('INR shop: the unit line reads "INR 40" with the suggested tag; the local names carry (Tamil)', /INR 40/.test(w.unitLine({ name: 'Tomato' }, { unit: 'kg', price: 40 })) && /suggested/.test(w.unitLine({ name: 'Tomato' }, { unit: 'kg', price: 40 })) && w.localOf(tomatoKg) === 'தக்காளி');
w = world({ currency: 'AED', _have: {}, _mine: {} }, ['Tamil']);
const line = w.unitLine({ name: 'Tomato' }, { unit: 'kg', price: 40 });
ok('AED shop: the table does NOT fit; the suggestion is null (blank), not 40', w.tableFits() === false && w.suggestedOf(tomatoKg) === null && JSON.stringify(w.priceOf(tomatoKg)) === '{"n":null,"whose":""}', JSON.stringify(w.priceOf(tomatoKg)));
ok('AED shop: the unit line is a dash — never "AED 40" — and carries no "suggested" tag', /—/.test(line) && !/AED 40|40/.test(line.replace(/<[^>]+>/g, '')) && !/suggested/.test(line), line);
ok('AED shop: the rupee table\'s local names are not carried either', w.localOf(tomatoKg) === '');
w = world({ currency: null, _have: {}, _mine: {} });
ok('a shop with no money (no country): no suggestion, and its unit line shows a dash', w.tableFits() === false && w.suggestedOf(tomatoKg) === null && /—/.test(w.unitLine({ name: 'Tomato' }, { unit: 'kg', price: 40 })));
w = world({ currency: 'AED', _have: { [tomatoKg.name + String.fromCharCode(1) + 'kg']: true }, _mine: mine(55) });
ok('AED shop that already sells Tomato kg at 55: shows ITS price, AED 55, tagged yours', JSON.stringify(w.priceOf(tomatoKg)) === '{"n":55,"whose":"yours"}' && /AED 55/.test(w.unitLine({ name: 'Tomato' }, { unit: 'kg', price: 40 })) && /yours/.test(w.unitLine({ name: 'Tomato' }, { unit: 'kg', price: 40 })), JSON.stringify(w.priceOf(tomatoKg)));
w = world(null);
ok('before the data loads (no DATA) the table is assumed to fit — nothing is hidden early', w.tableFits() === true);

console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
