/**
 * tests/tax-compute-counter.test.cjs — ⭐ TAX-SRV1: POST /api/tax/compute AGREES WITH THE COUNTER AND EXPLAINS ITSELF.
 *
 * The same bill is rung through the counter's own billMoney() (till.html, in a sandbox, CBTax = lib/tax.js) and quoted through the
 * real route (routes/tax.js, db + auth stubbed). Every figure the counter's slip reads (CBTax.moneyOf: taxable · tax · total · by_rate)
 * must be equal — for an INCLUSIVE and an EXCLUSIVE shop, in India, Australia and the UAE — when the caller does NOT say which way the
 * shop quotes (G2: the shop's setting, never a different default). Then each gap on its own:
 *   G1 money.by_rate · currency · pack { id, version, scheme }   G2 basis { price_includes_tax, from }   G3 an item_id-only line priced by
 *   services.priceLine   G5 refusals 400/422 with a code and a sentence, never 500 + raw text.
 * Run: node tests/tax-compute-counter.test.cjs · no DB, no network beyond 127.0.0.1.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const J = (x) => JSON.stringify(x);

const SHOP = '11111111-1111-4111-8111-111111111111';
const SHOPS = {
  IN: { gstn: '33AABCK1234F1Z6', country: 'IN', display_name: 'Chennai Stores' },
  AU: { gstn: '51824753556', country: 'AU', display_name: 'Sydney Stores' },
  AE: { gstn: '100123456700003', country: 'AE', display_name: 'Dubai Stores' },
};
let ROW = null;          /* the shop's identities row for the current case */
let SHELF = null;        /* what lib/tax-shelf readShelf answers */
let THROW = null;        /* a database fault to raise */

const dbPath = require.resolve(path.join(API, 'db'));
const answer = async (sql) => { if (THROW) throw THROW; if (/FROM identities WHERE identity_id = \$1/.test(String(sql))) return { rows: ROW ? [ROW] : [] }; return { rows: [] }; };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: answer, withEntity: async (id, fn) => fn({ query: answer }) } };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity' }; req.api_key = { scopes: ['tax'] }; next(); },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (req) => req.identity }) };
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => SHELF;
['reg-in', 'reg-au', 'reg-ae'].forEach((m) => require(path.join(API, 'lib', m)));
const REG = require(path.join(API, 'lib', 'regulation'));
const CBTAX = require(path.join(API, 'lib', 'tax.js'));
const MONEY = require(path.join(API, 'lib', 'money'));
const r2 = (n) => MONEY.round(Number(n) || 0);

/* ── the counter: its own billMoney() / moneyOf() / taxIncluded() / packSplitsByState() over a cart ── */
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
function fnText(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error(sig + ' is gone from till.html — this test is measuring nothing');
  const nl = src.indexOf('\n', at), oneLine = src.slice(at, nl);
  if (/\}\s*$/.test(oneLine) && (oneLine.match(/\{/g) || []).length === (oneLine.match(/\}/g) || []).length) return oneLine;
  return src.slice(at, src.indexOf('\n}\n', at) + 2);
}
const FNS = ['function billMoney(', 'function moneyOf(', 'function taxIncluded(', 'function packSplitsByState(', 'function shopPack(', 'function docCountry('];
function counter(c, inclusive, cart) {
  const sh = SHOPS[c];
  const ctx = { window: { CBRegulation: REG }, CBRegulation: REG, console, Object, Array, String, Number, JSON, Math, CBTax: CBTAX, r2,
    S: { shop: { name: sh.display_name, gstin: sh.gstn, state_code: c === 'IN' ? sh.gstn.slice(0, 2) : '', country: c, reg_type: 'regular' },
         policy: { price_includes_tax: inclusive ? 'yes' : 'no' } },
    CART: cart.map((x) => Object.assign({}, x)), BILL_DELIVERY: null, shopTax: () => ({ charges: true, kind: 'tax' }), custKnown: () => null,
    document: { getElementById: () => ({ value: '' }) } };
  ctx.window.CBTax = CBTAX;
  vm.createContext(ctx);
  vm.runInContext(FNS.map((s) => fnText(PAGE, s)).join('\n'), ctx);
  const m = vm.runInContext('billMoney()', ctx);
  return CBTAX.moneyOf(m.invoice);
}

/* ── the server ── */
const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/tax', require(path.join(API, 'routes', 'tax')));
let PORT;
const post = async (p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}/api/tax/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };

const RATES = { IN: [5, 18, 12], AU: [10, 10, 0], AE: [5, 5, 0] };
const cartOf = (c) => [
  { key: 'a', name: 'Oil 1L', unit: 'piece', qty: 2, price: 118, unitPrice: 118, save: 0, gst_rate: RATES[c][0], hsn: '1507' },
  { key: 'b', name: 'Soap', unit: 'piece', qty: 3, price: 33.33, unitPrice: 33.33, save: 4.99, gst_rate: RATES[c][1], hsn: '3401' },
  { key: 'c', name: 'Rice 5kg', unit: 'bag', qty: 1, price: 412.5, unitPrice: 412.5, save: 0, gst_rate: RATES[c][2], hsn: '1006' },
];
const quoteLines = (cart) => cart.map((x) => ({ key: x.key, name: x.name, qty: x.qty, unit_price: x.unitPrice, discount: x.save, gst_rate: x.gst_rate, hsn: x.hsn }));
const fig = (m) => ({ taxable: m.taxable, tax: m.tax, total: m.total, supply: m.supply, by_rate: m.by_rate });

(async () => {
  const srv = app.listen(0); PORT = srv.address().port;
  try {
    console.log('\n-- compute == counter on the same bill (priceIncludesTax LEFT OUT: the shop\'s setting decides) --');
    for (const c of ['IN', 'AU', 'AE']) {
      for (const inclusive of [true, false]) {
        ROW = Object.assign({ identity_id: SHOP, policy_flags: inclusive ? {} : { price_includes_tax: 'no' } }, SHOPS[c]);   /* {} = the default, 'yes' */
        SHELF = null;
        const cart = cartOf(c);
        const want = counter(c, inclusive, cart);
        const r = await post('compute', { lines: quoteLines(cart) });
        const got = r.json.money || {};
        const tag = c + ' ' + (inclusive ? 'inclusive' : 'exclusive');
        ok(tag + ': 200', r.status === 200, J(r.json));
        ok(tag + ': taxable · tax · total · by_rate equal to the paisa', J(fig(got)) === J(fig(want)), 'counter ' + J(fig(want)) + '\n          compute ' + J(fig(got)));
        ok(tag + ': tax charged (a real bill, not a zero)', want.tax > 0 && got.tax === want.tax);
        ok(tag + ': basis says the SHOP decided, and which way', J(r.json.basis) === J({ price_includes_tax: inclusive, from: 'shop' }), J(r.json.basis));
        ok(tag + ': lines agree line by line', J((got.lines || []).map((l) => [l.taxable, l.tax])) === J(want.lines.map((l) => [l.taxable, l.tax])));
      }
    }

    console.log('\n-- G1: tax by rate + currency + pack version --');
    ROW = Object.assign({ identity_id: SHOP, policy_flags: {} }, SHOPS.AU); SHELF = null;
    let r = await post('compute', { lines: quoteLines(cartOf('AU')) });
    ok('G1 currency = the seller pack\'s (AUD)', r.json.currency === 'AUD' && r.json.money.currency_code === 'AUD', J([r.json.currency, r.json.money && r.json.money.currency_code]));
    ok('G1 pack = { id AU, version x.y.z, scheme GST }', r.json.pack && r.json.pack.id === 'AU' && /^\d+\.\d+\.\d+$/.test(r.json.pack.version) && r.json.pack.scheme === 'GST' && r.json.pack.fallback === false, J(r.json.pack));
    ok('G1 by_rate carries each slab (10 and 0)', r.json.money && Object.keys(r.json.money.by_rate).sort().join(',') === '0,10', J(r.json.money && r.json.money.by_rate));
    ROW = Object.assign({ identity_id: SHOP, policy_flags: {} }, SHOPS.AE);
    r = await post('compute', { lines: quoteLines(cartOf('AE')) });
    ok('G1 UAE: AED · pack AE · VAT', r.json.currency === 'AED' && r.json.pack.id === 'AE' && r.json.pack.scheme === 'VAT', J([r.json.currency, r.json.pack]));

    console.log('\n-- G2: the caller\'s word wins when given; the shop\'s otherwise --');
    ROW = Object.assign({ identity_id: SHOP, policy_flags: {} }, SHOPS.IN);
    const one = [{ name: 'Oil', qty: 2, unit_price: 118, gst_rate: 18 }];
    r = await post('compute', { lines: one });
    ok('G2 inclusive shop, left out: 2 × 118 @18% totals 236 (the REV-01 reproduction)', r.json.money.total === 236 && r.json.money.tax === 36, J(fig(r.json.money)));
    r = await post('compute', { lines: one, priceIncludesTax: false });
    ok('G2 caller says exclusive: 278.48 and from caller', r.json.money.total === 278.48 && r.json.basis.from === 'caller', J([r.json.money.total, r.json.basis]));
    r = await post('compute', { lines: one, priceIncludesTax: 'no' });
    ok('G2 "no" reads as false', r.json.basis.price_includes_tax === false);
    ROW = Object.assign({ identity_id: SHOP, policy_flags: { price_includes_tax: 'no' } }, SHOPS.IN);
    r = await post('compute', { lines: one });
    ok('G2 exclusive shop, left out: tax ON TOP', r.json.money.total === 278.48 && r.json.basis.from === 'shop', J([r.json.money.total, r.json.basis]));

    console.log('\n-- G3: a line with only item_id is priced by the one price reader --');
    ROW = Object.assign({ identity_id: SHOP, policy_flags: {} }, SHOPS.IN);
    SHELF = { slabs: new Map(), categories: [], face: {}, items: [
      { item_id: 'p1', item_data: { name: 'Oil 1L', code: 'OIL1', price: { amount: '118' }, gst_rate: 18 } },
      { item_id: 'p2', item_data: { name: 'Bulk rice', code: 'RICE', price: 50, gst_rate: 5, pricing_kind: 'tiered', pricing_tiers: [{ qty: 1, price: 50 }, { qty: 10, price: 45 }] } },
      { item_id: 'p3', item_data: { name: 'Unpriced', price: '' } },
    ] };
    r = await post('compute', { lines: [{ item_id: 'p1', qty: 2 }] });
    ok('G3 item_id only → 118 from the shelf, 18% from the shelf, total 236', r.status === 200 && r.json.money.total === 236 && r.json.rates[0].gst_rate === 18, J([r.status, r.json.money && r.json.money.total, r.json.rates, r.json.message]));
    ok('G3 the answer says where the price came from', r.json.pricing && r.json.pricing[0] && r.json.pricing[0].unit_price === 118 && r.json.pricing[0].key === '0', J(r.json.pricing));
    ok('G3 the line takes the product\'s name', r.json.invoice.ItemList[0].PrdDesc === 'Oil 1L' || J(r.json.invoice.ItemList[0]).includes('Oil 1L'));
    r = await post('compute', { lines: [{ code: 'rice', qty: 10 }] });
    ok('G3 by code, at a quantity: the pricing structure answers (services.priceLine)', r.status === 200 && r.json.pricing[0].unit_price === 45 && r.json.pricing[0].list_price === 50 && r.json.pricing[0].structure === 'tiered' && r.json.money.total === 450, J(r.json.pricing));
    r = await post('compute', { lines: [{ item_id: 'p3', qty: 1 }] });
    ok('G3 a product with no price → 422 NO_PRICE, never taxed as 0', r.status === 422 && r.json.code === 'NO_PRICE' && /Unpriced|Line 1/.test(r.json.message), J(r));
    r = await post('compute', { lines: [{ item_id: 'nope', qty: 1 }] });
    ok('G3 an unknown product → 422 NO_PRICE with a sentence', r.status === 422 && r.json.code === 'NO_PRICE' && /not a product/.test(r.json.message), J(r));

    console.log('\n-- G5: refusals carry a code and a sentence; never 500 + raw text --');
    SHELF = null;
    const cases = [
      ['no lines', { lines: [] }, 400, 'NO_LINES'],
      ['qty 0', { lines: [{ name: 'Oil', qty: 0, unit_price: 1, gst_rate: 5 }] }, 400, 'BAD_QTY'],
      ['rate 140', { lines: [{ name: 'Oil', qty: 1, unit_price: 1, gst_rate: 140 }] }, 400, 'BAD_RATE'],
      ['basis "maybe"', { lines: one, priceIncludesTax: 'maybe' }, 400, 'BAD_PRICE_BASIS'],
    ];
    for (const [label, body, st, code] of cases) {
      r = await post('compute', body);
      ok('G5 ' + label + ' → ' + st + ' ' + code, r.status === st && r.json.code === code && typeof r.json.message === 'string' && r.json.message.length > 10, J(r));
    }
    r = await post('rate', { lines: [] });
    ok('G5 /rate with no lines → 400 NO_LINES', r.status === 400 && r.json.code === 'NO_LINES', J(r));
    THROW = Object.assign(new Error('relation "identities" does not exist at character 42'), { code: '42P01' });
    r = await post('compute', { lines: one });
    ok('G5 a fault → a code and a sentence, no raw database text', r.json.code === 'QUOTE_FAILED' && !/relation|character/.test(J(r.json)), J(r));
    THROW = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    r = await post('compute', { lines: one });
    ok('G5 a timeout → lib/knownerr\'s 503 STATEMENT_TIMEOUT', r.status === 503 && r.json.code === 'STATEMENT_TIMEOUT', J(r));
    THROW = null;
  } finally { srv.close(); }
  console.log('\n  ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
