/**
 * ord-43-unresolved-order-ref.test.cjs — ORD-43 (proof 2026-11-14): a product that adopts an order model by reference refuses to quantify until the reference resolves.
 * OWNS      the proof on the real code: core.js (cbDefsLive · cbDefsCached · cbOrderLive · cbOrderDecl, lifted) and the whole app/cart.js loaded into ONE vm sandbox. A product stores only order = { ref: 'om-carton' }.
 *           Before the shelf is read: typing 12 takes NOTHING (quantity 0, never "12 each"); once cbDefsLive has read the shelf ("Carton of 6", step 6): typing 13 becomes 12 (the nearest legal pack,
 *           Math.round(13/6)*6) and the line holds 12; a product citing a definition the shelf lacks is refused again ("missing"), quantity 0 - it never falls back to count.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/ord-43-unresolved-order-ref.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns, loadScript } = require('./lib/lift-fn.cjs');

const core = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'core.js'), 'utf8');
const i = core.indexOf('var _DEFS = {};');
const j = core.indexOf('function cbDefsCached');
if (i < 0 || j < 0) throw new Error('cbDefsLive block not found in core.js');
const block = core.slice(i, core.indexOf('\n', core.indexOf('}', j)));
let asked = 0;
const sb = loadScript('public/app/cart.js', {
  api: () => { asked++; return Promise.resolve({ definitions: [{ kind: 'ordermodel', definition_id: 'om-carton', name: 'Carton of 6', sub: 'pack', rules: { step: 6 } }] }); }
});
vm.runInContext(block + '\n' + liftFns('public/app/core.js', ['cbOrderLive', 'cbOrderDecl']) + '\nthis.cbOrderLive = cbOrderLive; this.cbOrderDecl = cbOrderDecl; this.cbDefsLive = cbDefsLive;', sb);
const Cart = sb.CBCart;

let bad = 0;
const ok = (m, c, info) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || !info ? '' : ' -> ' + info)); if (!c) bad++; };
const cat = { items: [
  { item_id: 'p1', item_data: { name: 'Rice 6-pack', price: 100, unit: 'pcs', order: { ref: 'om-carton' } } },
  { item_id: 'p2', item_data: { name: 'Dal gone', price: 80, unit: 'pcs', order: { ref: 'om-deleted' } } }
] };
(async () => {
  Cart.init('t', cat, {});
  Cart.setQty('t', 'p1', 12);
  ok('before the model can be read the line takes no quantity (0, not "12 each")', Cart.qtyOf('t', 'p1') === 0, String(Cart.qtyOf('t', 'p1')));
  await sb.cbDefsLive('ordermodel');
  ok('cbDefsLive read the shelf from the server (' + asked + ' read)', asked >= 1, String(asked));
  Cart.setQty('t', 'p1', 13);
  ok('once resolved, 13 becomes 12: the nearest legal pack of Carton of 6', Cart.qtyOf('t', 'p1') === 12, String(Cart.qtyOf('t', 'p1')));
  Cart.setQty('t', 'p2', 5);
  ok('a reference the shelf lacks is refused again: quantity 0, never a fallback to count', Cart.qtyOf('t', 'p2') === 0, String(Cart.qtyOf('t', 'p2')));
  process.exitCode = bad ? 1 : 0;
})();
