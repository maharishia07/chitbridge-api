#!/usr/bin/env node
// @type: contract
'use strict';
/**
 * till-stock-warn-noslab-1129.test.cjs - lane counterSmall (batch 1129, walk S2).
 * OWNS      proof, over functions lifted from tools/tally-connector/till.html, that (1) a line asking for more than the shelf count says
 *           "Only N in stock" and NEVER blocks (the words only; the cart is untouched), says nothing without a count, and (2) the Maintenance
 *           "No tax rate" chip flags only an item that states NO tax (a stated gst_rate, 0 included, a slab or an HSN is a stated tax).
 * CALLED BY scripts/guards.cjs . CI. No database, no network, no browser.
 * CARD      09-counter/till-selling
 * Run: node tests/till-stock-warn-noslab-1129.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
function lift(name) {
  const i = PAGE.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name + ' is not in the page');
  let d = 0; for (let k = PAGE.indexOf('{', i); k < PAGE.length; k++) { if (PAGE[k] === '{') d++; else if (PAGE[k] === '}') { d--; if (!d) return PAGE.slice(i, k + 1) + '\n'; } }
  throw new Error('unbalanced ' + name);
}
const ctx = { Math, Number, String, isFinite, esc: (x) => String(x), r2: (x) => Math.round(x * 100) / 100, S: null, CART: [], holdsStock: () => true,
  taxInputOf: (i) => { const o = {}; for (const k of ['tax_slab', 'gst_rate', 'hsn']) if (i[k] != null && String(i[k]).trim() !== '') o[k] = i[k]; return o; } };
vm.createContext(ctx);
vm.runInContext(['stockCountOf', 'stockWarnWords', 'stockWarnHTML', 'isStated', 'taxInputOrEmpty', 'statedTaxOf'].map(lift).join(''), ctx);
const run = (code) => vm.runInContext(code, ctx);
let n = 0, failed = 0;
const it = (name, fn) => { n++; try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); } };
const shelf = (qty) => { ctx.S = { items: [{ item_id: 'a', avail: qty === undefined ? null : { qty } }] }; };
const cart = (...q) => { ctx.CART = q.map((x) => ({ item_id: 'a', qty: x })); };
it('more than the count says Only N in stock', () => { shelf(3); cart(5); assert.strictEqual(run('stockWarnWords(CART[0])'), 'Only 3 in stock'); });
it('the cart is not touched (a warning, never a block)', () => { shelf(3); cart(5); run('stockWarnHTML(CART[0])'); assert.strictEqual(ctx.CART[0].qty, 5); });
it('exactly the count is fine', () => { shelf(3); cart(3); assert.strictEqual(run('stockWarnWords(CART[0])'), ''); });
it('no count kept says nothing (unknown is not none)', () => { shelf(undefined); cart(50); assert.strictEqual(run('stockWarnWords(CART[0])'), ''); });
it('zero on the shelf says Only 0 in stock', () => { shelf(0); cart(1); assert.strictEqual(run('stockWarnWords(CART[0])'), 'Only 0 in stock'); });
it('two lines of one product add up', () => { shelf(3); cart(2, 2); assert.strictEqual(run('stockWarnWords(CART[1])'), 'Only 3 in stock'); });
it('a shop holding no stock says nothing', () => { shelf(3); cart(5); ctx.holdsStock = () => false; assert.strictEqual(run('stockWarnWords(CART[0])'), ''); ctx.holdsStock = () => true; });
it('the html carries the testid and role', () => { shelf(1); cart(2); const h = run('stockWarnHTML(CART[0])'); assert.ok(/data-testid="till-stockwarn"/.test(h) && /role="status"/.test(h)); });
it('noslab: nothing stated is flagged', () => assert.strictEqual(run('statedTaxOf({name:"x"})'), false));
it('noslab: a stated 0% rate is NOT flagged', () => assert.strictEqual(run('statedTaxOf({gst_rate:0})'), true));
it('noslab: a stated "0" string rate is NOT flagged', () => assert.strictEqual(run('statedTaxOf({gst_rate:"0"})'), true));
it('noslab: a rate, a slab or an HSN is NOT flagged', () => { for (const i of [{ gst_rate: 5 }, { tax_slab: 's1' }, { hsn: '1905' }]) assert.strictEqual(run('statedTaxOf(' + JSON.stringify(i) + ')'), true); });
it('noslab: a blank rate is still flagged', () => assert.strictEqual(run('statedTaxOf({gst_rate:" "})'), false));
it('the chip hit uses statedTaxOf, not its own key list', () => assert.ok(/id: 'noslab'[\s\S]{0,700}hit: function\(i\)\{ return !statedTaxOf\(i\); \}/.test(PAGE)));
console.log('\n' + (n - failed) + '/' + n + ' passed'); process.exit(failed ? 1 : 0);
