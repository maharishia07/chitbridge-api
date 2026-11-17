'use strict';
/* CART-REG1 (T1-ORD, 2026-10-14): the cart's money is the SHOP's — never 'INR' because nobody said.
   app/cart.js answered 'INR' for the currency of every cart whose page passed none; a shop that never stated its money printed rupees.
   Now: the page's currency → the catalogue's shop.currency_code → the session's → none. None prints the bare amount and the server's
   one sentence (shop.money_why — api country-setup.MONEY_UNSTATED, code NO_MONEY) under the total.
   The CBCart unit run in node (the sandbox of tests/wx-cart-inclusive.test.cjs) with locale.js. Run: node tests/cart-currency.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const win = {}; const el0 = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} });
const sandbox = { window: win, console, setTimeout, clearTimeout, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el0, addEventListener() {}, body: el0(), head: el0() }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: { language: 'en-IN' } };
sandbox.self = win; Object.assign(win, sandbox); sandbox.window = win;
const cx = vm.createContext(sandbox);
cx.window = cx; cx.self = cx; Object.keys(win).forEach((k) => { if (!(k in cx)) cx[k] = win[k]; });
for (const f of ['engine/money.js', 'engine/tax.js', 'engine/locale.js', 'app/helpers.js', 'app/cart.js']) vm.runInContext(fs.readFileSync(__dirname + '/../public/' + f, 'utf8'), cx);
/* INT6a: app/helpers.js loaded too — cart.js's esc is the page's one (T2-WEBPRIMS), as on every page.
   W2-SHOP: locale.js is read from public/engine (T2-ENGONCE moved it there; the test still asked app/ and could not run) */
const CB = cx.CBCart; ok(CB && typeof CB.create === 'function', 'CBCart loads beside locale.js');

const WHY = 'Set the shop’s money and the month its year starts (Country setup) — nothing is billed or booked on a guess.';
const item = { item_id: 'rice', item_data: { name: 'Rice', price: 62 } };
const cat = (shop) => ({ shop, items: [item], offers: [] });

/* a shop that never stated its money */
const none = CB.create(cat({ currency_code: null, money_why: { code: 'NO_MONEY', why: WHY } }), {});
const f0 = CB.fmt(none.ns, 1234.5);
ok(!/₹|INR|Rs/.test(f0) && /1,?234\.50/.test(f0), 'no money stated → the bare amount, no rupee sign (' + f0 + ')');
ok(CB.symbolOf(none.ns) === '', 'no money stated → no symbol');
CB.add(none.ns, 'rice');
const r0 = none.reviewHTML({});
ok(/data-testid="cart-money-why"/.test(r0) && r0.includes('Country setup) — nothing is billed or booked on a guess.'),'the review carries the server\'s one sentence under the total');

/* a shop that stated AUD — the shop's money wins over nothing, without the page passing it */
const aud = CB.create(cat({ currency_code: 'AUD', money_why: null }), {});
const f1 = CB.fmt(aud.ns, 10);
ok(/\$/.test(f1) && !/₹/.test(f1), 'the catalogue\'s shop.currency_code is the cart\'s money (' + f1 + ')');
CB.add(aud.ns, 'rice');
ok(!/cart-money-why/.test(aud.reviewHTML({})), 'a shop with money says nothing extra');

/* the page's own currency still rules */
const page = CB.create(cat({ currency_code: null }), { currency: 'INR' });
ok(/₹/.test(CB.fmt(page.ns, 10)), 'a page that states its currency is obeyed');

/* no 'INR' default left in the cart */
const src = fs.readFileSync(__dirname + '/../public/app/cart.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok(!/['"]INR['"]/.test(src), 'app/cart.js names no INR default in code');
console.log(n + ' passed');
