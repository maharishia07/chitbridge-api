'use strict';
/**
 * tests/tax-compute.test.cjs — POST /api/tax/compute AGREES WITH THE COUNTER AND EXPLAINS ITSELF (TAX-SRV1, 2026-10-14).
 *
 * The REAL router over a stubbed database (the walk-in-buyer.test.cjs pattern: db/ and the auth middleware replaced in require.cache).
 * The counter's side is the counter's own engine — lib/tax-engine.browser.js, the bundle /engine/tax.js serves to till.html — called with
 * the input till.html billMoney() builds: the shop's taxIncluded() (price_includes_tax !== 'no'), a walk-in inside the shop's country.
 *   1 · compute == counter on the same bill, IN / AU / AE, inclusive and exclusive shops, the flag LEFT OUT (G2)
 *   2 · each gap: G1 money + currency + pack · G2 caller wins when it says · G3 item_id priced by the shelf · G5 codes, never raw text · G7 Home count
 * Run: node --test tests/tax-compute.test.cjs · no DB, no network (tests/support/tax-stub.cjs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const X = require('./support/tax-stub.cjs');   /* the shop in a stubbed db + the REAL routers — before any lib */
const { SHOP, shopRow } = X;
test.before(X.start);
test.after(X.stop);
const post = (body) => X.call('POST', '/api/tax/compute', body);

/* ── the counter's engine, loaded as a page loads it ── */
const page = {}; vm.createContext(page); vm.runInContext('var window = globalThis;', page);   /* in a page, window IS the global */
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'tax-engine.browser.js'), 'utf8'), page);
const CBTax = page.CBTax;

/** till.html billMoney(), the input it builds for a walk-in — nothing worked out here */
function counter(shop, cart) {
  const inclusive = !(shop.policy && shop.policy.price_includes_tax === 'no');
  const sc = shop.country === 'IN' ? String(shop.gstin).slice(0, 2) : '';
  return CBTax.determine({
    seller: { Gstin: shop.gstin, LglNm: shop.name, State: sc, Country: shop.country, RegType: 'regular' },
    buyer: { LglNm: 'Walk-in', Gstin: '', State: '', RegType: 'unregistered', Country: shop.country, Pos: CBTax.placeOfSupply({ delivery: undefined }, sc) },
    lines: cart.map((c) => ({ id: c.key, name: c.name, qty: c.qty, unit_price: c.price, discount: 0, gst_rate: c.gst_rate, cess_rate: 0 })),
    priceIncludesTax: inclusive, zeroRated: false,
  });
}

const SHOPS = {
  IN: { gstin: '33AAAAA0000A1Z5', name: 'Ponni Stores', country: 'IN', scheme: undefined, rates: [18, 5, 0] },
  AU: { gstin: '51824753556', name: 'Milk Bar', country: 'AU', scheme: undefined, rates: [10, 10, 0] },
  AE: { gstin: '100123456700003', name: 'Souq', country: 'AE', scheme: 'VAT', rates: [5, 5, 0] },
};

/* ── 1 · compute == counter ── */
for (const cc of Object.keys(SHOPS)) {
  for (const pit of ['yes', 'no']) {
    test(cc + ' shop, prices ' + (pit === 'yes' ? 'include' : 'exclude') + ' tax, flag left out: compute == counter, line by line', async () => {
      const s = Object.assign({}, SHOPS[cc], { policy: { price_includes_tax: pit } });
      SHOP.row = shopRow(s); SHOP.items = [];
      const cart = [{ key: 'a', name: 'One', qty: 3, price: 99.99, gst_rate: s.rates[0] }, { key: 'b', name: 'Two', qty: 1, price: 250, gst_rate: s.rates[1] }, { key: 'c', name: 'Three', qty: 2, price: 17.5, gst_rate: s.rates[2] }];
      const want = JSON.parse(JSON.stringify(counter(s, cart)));   /* out of the page's realm: plain objects */
      const r = await post({ scheme: s.scheme, lines: cart.map((c) => ({ key: c.key, name: c.name, qty: c.qty, price: c.price, gst_rate: c.gst_rate })) });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.price_includes_tax, { value: pit === 'yes', source: 'shop' });
      assert.deepEqual(r.body.invoice.ValDtls, want.ValDtls, 'the totals and every head');
      assert.deepEqual(r.body.invoice.ItemList.map((i) => [i.AssAmt, i.TotItemVal]), want.ItemList.map((i) => [i.AssAmt, i.TotItemVal]), 'each line');
      assert.equal(r.body.invoice._cb.supply, want._cb.supply);
      assert.deepEqual(r.body.money.by_rate, JSON.parse(JSON.stringify(CBTax.moneyOf(want).by_rate)), 'by rate');
      assert.ok(r.body.money.tax > 0, 'tax is charged');
    });
  }
}

/* ── 2 · each gap ── */
test('G2: a shop with no setting is inclusive (policy default yes, as the counter); the caller\'s own flag wins when it says one', async () => {
  SHOP.row = shopRow(Object.assign({}, SHOPS.IN, { policy: {} })); SHOP.items = [];
  const line = [{ name: 'Rice', qty: 1, price: 118, gst_rate: 18 }];
  let r = await post({ lines: line });
  assert.deepEqual(r.body.price_includes_tax, { value: true, source: 'shop' }); assert.equal(r.body.invoice.ValDtls.TotInvVal, 118);
  r = await post({ lines: line, priceIncludesTax: false });
  assert.deepEqual(r.body.price_includes_tax, { value: false, source: 'caller' }); assert.equal(r.body.invoice.ValDtls.TotInvVal, 139.24);
  r = await post({ lines: line, price_includes_tax: 'no' });
  assert.equal(r.body.price_includes_tax.value, false);
  r = await post({ lines: line, priceIncludesTax: 'maybe' });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'BAD_FLAG');
});

test('G1: the answer says tax by rate, the currency and the pack version — AU in AUD, never INR', async () => {
  SHOP.row = shopRow(SHOPS.AU); SHOP.items = [];
  const r = await post({ lines: [{ name: 'Flat white', qty: 1, price: 100, gst_rate: 10 }], priceIncludesTax: false });
  assert.equal(r.body.currency, 'AUD'); assert.equal(r.body.money.currency_code, 'AUD');
  assert.equal(r.body.pack.id, 'AU'); assert.match(r.body.pack.version, /^\d+\.\d+\.\d+$/); assert.equal(r.body.pack.code, null);
  assert.equal(r.body.money.by_rate['10'].tax, 10);
});
test('G1: a country with no pack is computed but says so — currency null, the code and the sentence', async () => {
  SHOP.row = shopRow({ gstin: 'X1', name: 'Diner', country: 'ZZ' });   /* US has a pack since engines v1.6x — ZZ has none */ SHOP.items = [];
  const r = await post({ lines: [{ name: 'Pie', qty: 1, price: 10, gst_rate: 0 }] });
  assert.equal(r.status, 200); assert.equal(r.body.currency, null); assert.equal(r.body.pack.code, 'NO_COUNTRY_PACK'); assert.ok(r.body.pack.why);
});
test('G1/G5: a shop with no country is refused 422 NO_COUNTRY — tax is never worked out as India on a guess', async () => {
  SHOP.row = shopRow({ gstin: null, name: 'Nowhere', country: null }); SHOP.items = [];
  const r = await post({ lines: [{ name: 'Pie', qty: 1, price: 10, gst_rate: 5 }] });
  assert.equal(r.status, 422); assert.equal(r.body.code, 'NO_COUNTRY'); assert.ok(r.body.message);
});

test('G3: a line with only item_id is priced by the one price reader (the shelf price, its rate) — same as sending the price', async () => {
  SHOP.row = shopRow(SHOPS.IN);
  SHOP.items = [{ item_id: 'P1', item_data: { name: 'Ponni Rice', price: 118, gst_rate: 18 } }, { item_id: 'P2', item_data: { name: 'Unpriced', gst_rate: 5 } }];
  const r = await post({ lines: [{ item_id: 'P1', qty: 2 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.priced[0], { key: '0', unit_price: 118, source: 'shelf', structure: null, why: 'list price' });
  const same = await post({ lines: [{ name: 'Ponni Rice', qty: 2, price: 118, gst_rate: 18 }] });
  assert.deepEqual(r.body.invoice.ValDtls, same.body.invoice.ValDtls);
  let x = await post({ lines: [{ item_id: 'P2', qty: 1 }] });
  assert.equal(x.status, 422); assert.equal(x.body.code, 'NO_PRICE'); assert.match(x.body.message, /Unpriced/);
  x = await post({ lines: [{ item_id: 'NOPE', qty: 1 }] });
  assert.equal(x.status, 422); assert.equal(x.body.code, 'ITEM_NOT_FOUND');
});
test('G3: an unregistered GST shop (no GSTIN, no shelf) still finds and prices its item — and charges no tax', async () => {
  SHOP.row = shopRow({ gstin: null, name: 'Small Shop', country: 'IN' });
  SHOP.items = [{ item_id: 'P1', item_data: { name: 'Ponni Rice', price: 100, gst_rate: 18 } }];
  const r = await post({ lines: [{ item_id: 'P1', qty: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.priced[0].unit_price, 100); assert.equal(r.body.money.tax, 0);
});

test('G5: malformed lines answer 400 with a code and a sentence', async () => {
  SHOP.row = shopRow(SHOPS.IN); SHOP.items = [];
  const cases = [[{ lines: [] }, 'NO_LINES'], [{ lines: [{ name: 'A', qty: 0, price: 1 }] }, 'BAD_QTY'], [{ lines: [{ name: 'A', qty: 1, price: -1 }] }, 'BAD_PRICE'],
    [{ lines: [{ name: 'A', qty: 1, price: 1, gst_rate: 180 }] }, 'BAD_RATE'], [{ lines: [{ name: 'A', qty: 1 }] }, 'NO_PRICE']];
  for (const [body, code] of cases) {
    const r = await post(body);
    assert.equal(r.status, 400, code); assert.equal(r.body.code, code); assert.ok(r.body.message && r.body.message.length < 120);
  }
});
test('G5: a fault inside is 500 with a code and a sentence — the raw error text never leaves', async () => {
  SHOP.row = shopRow(SHOPS.IN); SHOP.boom = new Error('relation "secret_table" does not exist at 10.0.0.7');
  try {
    const r = await post({ lines: [{ name: 'A', qty: 1, price: 1, gst_rate: 5 }] });
    assert.equal(r.status, 500); assert.equal(r.body.code, 'TAX_FAILED'); assert.doesNotMatch(JSON.stringify(r.body), /secret_table|10\.0\.0\.7/);
    const k = await post({ lines: [{ name: 'A', qty: 1, price: 1, gst_rate: 5 }] }).catch(() => null);
    assert.ok(k);
  } finally { SHOP.boom = null; }
  SHOP.boom = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  try { const r = await post({ lines: [{ name: 'A', qty: 1, price: 1, gst_rate: 5 }] }); assert.equal(r.status, 503); assert.equal(r.body.code, 'STATEMENT_TIMEOUT'); }
  finally { SHOP.boom = null; }
});

test('G7: Home\'s Tax Lab says how many products have no tax slab — the shelf\'s rule (0% is a slab; nothing is not)', async () => {
  const H = require('../lib/home-facts');
  SHOP.row = shopRow(SHOPS.IN);
  assert.equal((await X.call('GET', '/api/facts/tax-lab')).status, 200, 'the card is served');
  SHOP.items = [{ item_id: 'P1', item_data: { name: 'Rice', gst_rate: 5 } }, { item_id: 'P2', item_data: { name: 'Milk', gst_rate: 0 } },
    { item_id: 'P3', item_data: { name: 'Pen', cost: { value: 4242 } } }, { item_id: 'P4', item_data: { name: 'Ink' } }];
  let f = await H.BUILD['tax-lab']({ entity: 'E1' });
  assert.deepEqual(f.lines, [{ text: '2 products have no tax slab', value: 2, tone: 'dn' }]); assert.deepEqual(f.figures, { products: 4, no_slab: 2 });
  assert.doesNotMatch(JSON.stringify(f), /4242/, 'cost never travels');
  SHOP.items = SHOP.items.slice(0, 2);
  f = await H.BUILD['tax-lab']({ entity: 'E1' });
  assert.deepEqual(f.lines, [{ text: 'Every product has a tax slab', value: 0 }]);
  SHOP.row = shopRow({ gstin: null, name: 'Small', country: 'IN' });
  f = await H.BUILD['tax-lab']({ entity: 'E1' });
  assert.deepEqual(f.lines, []); assert.ok(f.unavailable, 'omitted, and why — never 0');
});
