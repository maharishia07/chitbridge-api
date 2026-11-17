'use strict';
/* T2e (M178): a placed order empties the cart — the CBCart unit (public/app/cart.js) run in node, no browser; shop.html's confirm
   step is checked by source. Run: node tests/t2e-cart.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const win = {}; const el0 = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} });
const sandbox = { window: win, console, setTimeout, clearTimeout, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el0, addEventListener() {}, body: el0(), head: el0() }, localStorage: { getItem: () => null, setItem() {} } };
sandbox.self = win; Object.assign(win, sandbox); sandbox.window = win;
const cx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cart.js', 'utf8'), cx);
const CB = cx.CBCart || win.CBCart; ok(CB && typeof CB.create === 'function', 'CBCart loads');
const cat = { items: [{ item_id: 'a', name: 'Tea', price: 5000, unit: 'piece' }, { item_id: 'b', name: 'Sugar', price: 6500, unit: 'piece' }] };
const cart = CB.create(cat, { pageSize: 50, symbol: '₹', currency: 'INR' });
cart.add('a'); cart.add('b'); cart.add('b');
ok(cart.selected().length === 2, 'two lines in the cart before the order');
cart.clear();
ok(cart.selected().length === 0 && !cart.lines(), 'place → clear → the cart is empty (no lines, no total)');
const shop = fs.readFileSync(__dirname + '/../public/shop.html', 'utf8');
const i = shop.search(/var title\s*=\s*isCart\s*\?\s*'Order placed'/), j = shop.indexOf('CBOffline.clearDraft', i);
ok(i > 0 && /_CART\.clear\(\)/.test(shop.slice(i, j)), 'M178: shop.html empties _CART when the order is placed');
console.log(n + ' passed');
