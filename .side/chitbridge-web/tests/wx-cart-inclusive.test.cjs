'use strict';
/* WX-O2C (2026-10-13): a shop whose shelf prices INCLUDE tax (the default policy) must not see the tax added on top in the cart's money block.
   The CBCart unit (public/app/cart.js) run in node with the vendored tax engine (public/engine/tax.js) — no browser.
   Found on the real stack: a ₹209 basket (Ponni raw rice 62 × 2 + Toor dal 85, 5 %) showed "GST ₹10.45 · Total incl. tax ₹219.45" while the
   server priced the order at ₹209. Run: node tests/wx-cart-inclusive.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const win = {}; const el0 = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} });
const sandbox = { window: win, console, setTimeout, clearTimeout, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el0, addEventListener() {}, body: el0(), head: el0() }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: { language: 'en-IN' } };
sandbox.self = win; Object.assign(win, sandbox); sandbox.window = win;
const cx = vm.createContext(sandbox);
/* INT5b: engine/tax.js is now the regulation bundle (reg-* · regulation · tax-packs · tax-slab · tax) — its parts find each other on `window`,
   so the sandbox's window IS its global, as in a browser */
cx.window = cx; cx.self = cx; Object.keys(win).forEach((k) => { if (!(k in cx)) cx[k] = win[k]; });
/* the engines attach to window.*; in a browser window === the global, so the page's free names resolve — the sandbox mirrors that */
vm.runInContext(fs.readFileSync(__dirname + '/../public/engine/money.js', 'utf8'), cx);
vm.runInContext(fs.readFileSync(__dirname + '/../public/engine/tax.js', 'utf8'), cx);
['CBMoney', 'CBTax', 'CBTaxSlab', 'CBTaxPacks'].forEach((k) => { if (win[k] && !cx[k]) cx[k] = win[k]; });
vm.runInContext(fs.readFileSync(__dirname + '/../public/app/helpers.js', 'utf8'), cx);   /* T2-WEBPRIMS: the one esc, loaded first as on the page */
vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cart.js', 'utf8'), cx);
const CB = cx.CBCart || win.CBCart; ok(CB && typeof CB.money === 'function', 'CBCart loads beside the tax engine');
ok((cx.CBTax || win.CBTax) && typeof (cx.CBTax || win.CBTax).splitLineTax === 'function', 'the engine exposes splitLineTax (the one split the counter bill uses)');

const lines = [{ key: 'rice', item_id: 'rice', unitPrice: 62, qty: 2 }, { key: 'dal', item_id: 'dal', unitPrice: 85, qty: 1 }];
const taxOf = () => ({ rate: 5, name: 'GST' });
const ctx = { now: new Date(), currency: 'INR', money: (x) => '₹' + Number(x).toFixed(2) };

/* the default — prices without tax: unchanged */
const ex = CB.money(lines, { ctx, taxOf });
ok(ex.grand === 219.45 && ex.taxTotal === 10.45 && ex.inclusive === false, 'prices WITHOUT tax: GST 10.45 is added, total 219.45 (as before)');
ok(/Total incl\. tax/.test(CB.moneyRowsHTML(ex, {})), '…and the block says "Total incl. tax"');

/* the shop's default — prices that include tax: the split comes out of the price, the total IS the price */
const inc = CB.money(lines, { ctx, taxOf, priceIncludesTax: true });
ok(inc.inclusive === true && inc.grand === 209, 'prices that INCLUDE tax: the total is the shelf price, 209 — nothing added');
ok(inc.taxTotal === 9.96 && inc.byRate['GST · 5%'] === 9.96, 'the GST inside the prices is the engine\'s own split per line (124 → 118.10 + 5.91 · 85 → 80.95 + 4.05 = 9.96), never a second formula');
const html = CB.moneyRowsHTML(inc, { plainUntaxed: true });
ok(/included/.test(html) && !/Total incl\. tax/.test(html) && /₹209\.00/.test(html), 'the block says "GST · 5% included" and "Total ₹209.00"');
/* the same from recorded lines (the order page prints what the cart printed) */
const rec = CB.moneyFromLines([{ name: 'Ponni raw rice 1 kg', quantity: 2, price: 62, gst_rate: 5 }, { name: 'Toor dal 500 g', quantity: 1, price: 85, gst_rate: 5 }], Object.assign({ priceIncludesTax: true }, ctx));
ok(rec.grand === 209 && rec.taxTotal === 9.96 && rec.inclusive === true, 'moneyFromLines with priceIncludesTax: the same 209 / 9.96');
/* the ctx can carry it too (shop.html passes its context once) */
ok(CB.money(lines, { ctx: Object.assign({ priceIncludesTax: true }, ctx), taxOf }).grand === 209, 'ctx.priceIncludesTax is honoured when the option is not given');

/* the storefront wires the flag from the catalogue answer, and loads the engine before the cart */
const shop = fs.readFileSync(__dirname + '/../public/shop.html', 'utf8');
ok(/priceIncludesTax:\s*!!\(_SHOPDATA&&_SHOPDATA\.shop&&_SHOPDATA\.shop\.price_includes_tax\)/.test(shop), 'shop.html passes shop.price_includes_tax as priceIncludesTax');
ok(shop.indexOf('src="engine/tax.js"') > 0 && shop.indexOf('src="engine/tax.js"') < shop.indexOf('src="app/cart.js"'), 'shop.html loads engine/tax.js before cart.js');
console.log(n + ' passed');
