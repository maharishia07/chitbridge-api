/**
 * tests/till-pricing-1135.test.cjs - CAT-352 / CAT-347 / CAT-340: the counter prices with the ONE pricing engine and passes the chosen customer's groups to the ONE offers engine.
 * OWNS      the counter page's OWN functions (lifted from tools/tally-connector/till.html) over the REAL lib/pricing-engine.js and lib/offers-engine.js and the REAL tax engine.
 * Hand computation (from PM/sim-year/catalogue-readiness/expected.json, AUD, prices GST-inclusive 10%):
 *   CAT-352  Paint list 60.00, breaks from 4 at 55.00 and from 10 at 50.00: 12 units = 12 x 50.00 = 600.00; GST 600/11 = 54.545 -> 54.55. (Before: 12 x 60.00 = 720.00.)
 *   CAT-347  Primer 40.00, offer 10% off only for group "regular": a named regular customer 40.00 x 0.90 = 36.00; a walk-in 40.00; a named customer NOT in the group 40.00.
 *   CAT-340  the same paint rung as two lines (two shades, 6 + 6): breaks are read per ITEM (12 units) so each unit is 50.00 = 600.00 (before: 2 x 6 x 55.00 = 660.00).
 * Run: node tests/till-pricing-1135.test.cjs
 */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const ENGINE = { console, Math, Date, JSON, Object, Array, String, Number, Map, Set, Error, RegExp, isNaN, parseFloat, Intl };
ENGINE.window = ENGINE; ENGINE.self = ENGINE;
vm.createContext(ENGINE);
['tax-engine.browser.js', 'pricing-engine.js', 'offers-engine.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(API, 'lib', f), 'utf8'), ENGINE));
const MONEY = require(path.join(API, 'lib', 'money'));
const r2 = (n) => MONEY.round(Number(n) || 0);
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
function fnText(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error(sig + ' is gone from the source - this test is measuring nothing');
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end + 2);
}
const LIFT = ['var QUIET_MAX = 200, QUIET = [];', 'function cbQuiet(', 'function billMoney(', 'function stateOfTaxId(', 'function billWhen(', 'function billStopMoney(', 'function noDayMoney(', 'function dayInZone(', 'function tzOpt(', 'function shopTz(',
  'function taxIncluded(', 'function taxInputOf(', 'function lineOf(', 'function pricedAt(', 'function price(', 'function priceCartLine(', 'function stampTaxRate(', 'function custGroupsNow(', 'function itemQty(', 'function addItem(', 'function lineKey(', 'function moneyOf(', 'function moneyStop('];
const SLAB10 = { definition_id: 'gst-10', kind: 'tax', name: 'GST 10%', rate: 10 };
const PAINT = { item_id: 'P', name: 'Paint 4L', price: 60, unit: 'piece', gst_rate: 10, pricing_kind: 'tiered', pricing_def_name: 'Paint breaks', pricing_tiers: [{ qty: 4, price: 55 }, { qty: 10, price: 50 }] };
const PRIMER = { item_id: 'R', name: 'Primer', price: 40, unit: 'piece', gst_rate: 10 };
const OFFER = { id: 'o1', kind: 'percent_off', label: 'Regulars 10% off', percent: 10, scope: 'line', customer_group: 'regular' };
const CUSTOMERS = [{ identity_id: 'c-reg', name: 'Rita Regular', groups: [], segment: 'regular' }, { identity_id: 'c-new', name: 'Nina New', groups: [], segment: 'new' }];

function counter(customerName) {
  const els = { cname: { value: customerName || '' } };
  const ctx = {
    window: ENGINE, CBPricing: ENGINE.CBPricing, CBOffers: ENGINE.CBOffers, CBTax: ENGINE.CBTax, CBRegulation: ENGINE.CBRegulation, console, Object, Array, String, Number, JSON, Math, Date, Promise, isNaN,
    CBVariant: { keyOf: (id, mods) => id + (mods && mods.length ? '|' + JSON.stringify(mods) : ''), addedPrice: () => 0 },
    CBUnits: require('../lib/units'), MONEY: () => MONEY, r2, rmoney: r2, esc: (v) => String(v == null ? '' : v), money: (v) => (Number(v) || 0).toFixed(2),
    S: { shop: { name: 'Riverbend', abn: '51824753556', country: 'AU', reg_type: 'regular', currency: 'AUD' }, slabs: [SLAB10], categories: [], face: {}, at: '2026-11-27T05:00:00.000Z', offers: [OFFER], customers: CUSTOMERS,
         policy: { price_includes_tax: 'yes' } },
    CART: [], BILL_DELIVERY: null,
    packSplitsByState: () => false, shopTax: () => ({ charges: true, kind: 'tax' }), shopCur: () => 'AUD', custKnown: () => null, schemeWord: () => 'GST',
    modAdd: () => 0, shopDayOf: () => true, netKey: (k) => k, EV: null, ageOf: () => null, stampBands() {}, paintCartRow: () => true, paintCart() {}, paintTotals() {}, paintQuick() {}, paintHits() {}, paintDayPill() {}, draftSave() {},
    document: { getElementById: (id) => els[id] || { value: '', textContent: '', innerHTML: '' }, querySelectorAll: () => [] },
  };
  vm.createContext(ctx);
  vm.runInContext(LIFT.map((s) => fnText(PAGE, s)).join('\n'), ctx);
  const add = (item, qty, mods) => { ctx.__i = item; ctx.__m = mods || null; vm.runInContext('addItem(__i, ' + qty + ', __m)', ctx); };
  return { ctx, add, run: () => vm.runInContext('price(), billMoney()', ctx), line: (n) => ctx.CART[n || 0] };
}
const minor = (v) => Math.round(Number(v) * 100);

/* CAT-352 */
let c = counter(); c.add(PAINT, 12); let m = c.run();
ok('CAT-352: 12 units on a 60.00 list with a break from 10 at 50.00 ring 600.00, not 720.00', minor(c.line().net) === 60000, 'net ' + c.line().net);
ok('CAT-352: the books figure follows the priced unit: GST 54.55', minor(m.tax) === 5455, 'tax ' + m.tax);
c = counter(); c.add(PAINT, 3); c.run(); ok('CAT-352: 3 units sit below the first break and stay at the list 60.00 (180.00)', minor(c.line().net) === 18000, 'net ' + c.line().net);
c = counter(); c.add(PAINT, 5); c.run(); ok('CAT-352: 5 units take the first break, 55.00 each (275.00)', minor(c.line().net) === 27500, 'net ' + c.line().net);

/* CAT-340: the quantity is the ITEM's, not the line's */
c = counter(); c.add(PAINT, 6, [{ group: 'Shade', option: 'Navy' }]); c.add(PAINT, 6, [{ group: 'Shade', option: 'Teal' }]); c.run();
ok('CAT-340: two lines of one item (6 + 6) are two lines', c.ctx.CART.length === 2, 'lines ' + c.ctx.CART.length);
ok('CAT-340: breaks are read on the 12 units of the ITEM: each line is 6 x 50.00 = 300.00', c.ctx.CART.every((l) => minor(l.net) === 30000), c.ctx.CART.map((l) => l.net).join(','));

/* CAT-347 */
c = counter('Rita Regular'); c.add(PRIMER, 1); c.run();
ok('CAT-347: a named customer in group "regular" gets the customer-only offer: Primer 36.00', minor(c.line().net) === 3600, 'net ' + c.line().net);
c = counter(''); c.add(PRIMER, 1); c.run();
ok('CAT-347: a walk-in gets no customer-only offer, by design: Primer 40.00', minor(c.line().net) === 4000, 'net ' + c.line().net);
c = counter('Nina New'); c.add(PRIMER, 1); c.run();
ok('CAT-347: a named customer NOT in the group pays 40.00', minor(c.line().net) === 4000, 'net ' + c.line().net);
c = counter('Rita Regular'); c.ctx.S.customers = [{ identity_id: 'c-reg', name: 'Rita Regular', groups: ['trade'], segment: 'new' }]; c.ctx.S.offers = [Object.assign({}, OFFER, { customer_group: 'group:trade' })]; c.add(PRIMER, 1); c.run();
ok('CAT-347: a named group the seller placed the customer in ("group:trade") applies too', minor(c.line().net) === 3600, 'net ' + c.line().net);

/* the snapshot carries what the counter needs */
const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
ok('CAT-347: the snapshot ships the customer-only offers (all: true) and each customer segment', /liveOffers\(\{ entity_id, withEntity, viewer: null, groups: \[\], all: true \}\)/.test(src) && /AS segment/.test(src));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
