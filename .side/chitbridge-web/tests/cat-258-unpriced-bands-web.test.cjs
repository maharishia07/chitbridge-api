'use strict';
/* CAT-258 (web twin of api #930): the product page's Pricing row says "no price set" for an unpriced tiered product, never a free 0 band.
   OWNS    prodPricingHTML (public/app.html), run in node over the REAL engine copy (public/engine/pricing.js + money.js) with the page's helpers stubbed.
   CALLED BY CI (tests/*.test.cjs). No browser: Playwright is not needed for this unit; e2e/tests/pricing-structure.spec.js covers the priced screen.
   CARD    07-offers-pricing-and-combos/pricing-structure
   Run: node tests/cat-258-unpriced-bands-web.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const pub = (f) => fs.readFileSync(__dirname + '/../public/' + f, 'utf8');
const app = pub('app.html');
const start = app.indexOf('function pricingListOf(product) {');
const close = '\n}\n';
const end = app.indexOf(close, app.indexOf('function prodPricingHTML(d) {')) + close.length;
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const cx = vm.createContext({ console, window: {}, document: { getElementById: () => null } });
cx.window = cx;
for (const f of ['engine/money.js', 'engine/pricing.js']) vm.runInContext(pub(f), cx);
vm.runInContext(`
const UI = { prodMode: 'view', _invQty: 5 };
const tx = (s) => s, txf = (s, o) => s.replace(/\{(\w+)\}/g, (m, k) => o[k]), esc = (s) => String(s), inr = (n) => 'Rs ' + Number(n).toFixed(2), pUnit = () => 'kg';
const cbDefsCached = () => [], cbPricingOptionsHTML = () => '', goCatsetSec = () => {};
const pPrice = (d) => d.price, pData = (d) => d;
const cbHasPrice = (v) => v != null && v !== '';
const cbAmount = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
${app.slice(start, end)}`, cx);
const tiered = { pricing_kind: 'tiered', pricing_tiers: [{ qty: 10, price: 8 }] };
const html = (d) => vm.runInContext('prodPricingHTML', cx)(Object.assign({}, tiered, d));
const unpriced = html({});
ok(/no price set/.test(unpriced), 'an unpriced tiered product says "no price set"');
ok(!/Rs 0\.00/.test(unpriced), 'and shows no free 0.00 band or unit price');
ok(/Rs 8\.00/.test(unpriced), 'the tier price 8 is still shown');
const priced = html({ price: 10 });
ok(!/no price set/.test(priced) && /Rs 10\.00/.test(priced), 'a priced product shows its list price in the first band');
const free = html({ price: 0 });
ok(/Rs 0\.00/.test(free) && !/no price set/.test(free), 'a real 0 price is a free band, told apart from no price');
console.log(n + ' passed');
