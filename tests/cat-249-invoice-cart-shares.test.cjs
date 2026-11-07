/**
 * tests/cat-249-invoice-cart-shares.test.cjs — CAT-249: POST /api/invoice/build takes a basket offer's share per line from the OFFER ENGINE
 * (ev.cart_shares, split by running net), as lib/offers-live.js does for the chit; it never splits by gross a second way.
 *
 * OWNS      the build answer for A 100 (5%) + B 100 (18%), "A free" (amount_off 100, line) + "30 off the basket":
 *           hand-computed: A net 0, so the whole 30 lands on B (net 100 -> 70); engine total 70; tax A 0 + B 70 x 18% = 12.6; TotInvVal 82.6.
 *           Gross split (the bug) gave A discount 115 (> its gross 100) and TotInvVal 100.3.
 * CALLED BY scripts/guards.cjs · CI. No database, no network (shelf and shop stubbed on lib/services).
 * FLOW      the REAL router routes/invoice.js (path from CAT249_ROUTE, for the mutation check) + the REAL services/offers engine/tax -> /build
 * CARD      07-offers-pricing-and-combos
 * Run: node tests/cat-249-invoice-cart-shares.test.cjs
 */
'use strict';
const http = require('http');
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stubMod = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const realAuth = require('../middleware/auth');
stubMod('middleware/auth.js', Object.assign((req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity', entity_id: 'e1' }; next(); },
  { entityOf: () => 'e1', requireScope: () => (req, res, next) => next(), userOf: (r) => r.identity, allowsKey: realAuth.allowsKey }));
const S = require('../lib/services');
S.shelfOf = async () => ({ shelf: null, items: [], byId: new Map(), byCode: new Map(), idOf: () => null, productOf: () => null });
S.shopOf = async () => ({ party: { LglNm: 'Shop', Gstin: '33AAAAA0000A1Z5', State: '33', Country: 'IN', RegType: 'regular' }, priceIncludesTax: false });

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(90) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/invoice', require(process.env.CAT249_ROUTE || '../routes/invoice'));
const srv = http.createServer(app);
const post = (body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const rq = http.request({ port: srv.address().port, path: '/api/invoice/build', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
    (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
  rq.on('error', reject); rq.end(data);
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const lines = [{ key: 'A', name: 'A', qty: 1, price: 100, gst_rate: 5, item_id: 'ia' }, { key: 'B', name: 'B', qty: 1, price: 100, gst_rate: 18, item_id: 'ib' }];
  const offers = [
    { id: 'free', label: 'A free', kind: 'amount_off', amount: 100, scope: 'line', applies_to: { item_ids: ['ia'] } },
    { id: 'basket', label: '30 off the basket', kind: 'amount_off', amount: 30, scope: 'cart' }
  ];
  const r = await post({ lines, offers, buyer: { LglNm: 'Walk-in' } });
  t('status 200', r.status, 200);
  t('engine total 70 (hand-computed: 200 - 100 - 30)', r.body.offers.total, 70);
  const items = r.body.invoice.ItemList;
  t('A: discount = its 100 gross, never more (the line offer emptied it)', items[0].Discount, 100);
  t('A: taxable value 0', items[0].AssAmt, 0);
  t('B: discount = the whole basket 30 (A holds none of it)', items[1].Discount, 30);
  t('B: taxable value 70', items[1].AssAmt, 70);
  t('invoice total 82.6 = 70 + 18% of 70', r.body.invoice.ValDtls.TotInvVal, 82.6);
  srv.close();
  console.log('\ncat-249: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail || !pass ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
