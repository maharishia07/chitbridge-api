#!/usr/bin/env node
/**
 * pricing-route-tier.test.cjs — CAT-221 (W45 100% target): pricing at a quantity, tested THROUGH THE ROUTE (POST /api/pricing/price).
 *
 * OWNS      the answers of routes/pricing.js that the api-problem sweep cannot see (it checks a refusal's shape, not the price): a tiered product read from the
 *           shop's shelf, priced at the break (10 -> 90, the tier, its sentence, two bands, the total), below the break (9 -> list price, its sentence), and
 *           an unpriced product (null, "no price set" - never 0, D3).
 * CALLED BY by hand and CI (not the offline gate). No database, no network: the real router, lib/services.priceLine and the real pricing engine
 *           over a stand-in identity and a stand-in shelf (services.shelfOf).
 * FLOW      POST /api/pricing/price { lines:[{code, qty}] } -> shelfOf (stub) -> priceLine -> { lines, total }
 * The web half of CAT-221 (e2e/till-tier.cjs through till.html CBPricing.unitPrice) is the web repo's.
 * Run: node tests/pricing-route-tier.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(84) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exported) => {
  const file = require.resolve(path.join(HERE, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};

const SHOP = '11111111-1111-4111-8111-111111111111';
const realAuth = require(path.join(HERE, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' }; next(); };
mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.identity_id }));
console.error = () => undefined;
console.warn = () => undefined;

/* the shop's shelf: tea is tiered (90 each from 10) with a list price of 100; salt has no price at all */
const SHELF = {
  tea: { code: 'tea', name: 'Tea', price: { amount: 100, currency: 'INR' }, pricing_kind: 'tiered', pricing_tiers: [{ qty: 10, price: 90 }] },
  salt: { code: 'salt', name: 'Salt' }
};
const services = require(path.join(HERE, 'lib', 'services'));
services.shelfOf = async () => ({ productOf: (line) => SHELF[String(line.code || '').toLowerCase()] || null });

function price(port, lines) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify({ lines }));
    const q = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/pricing/price', headers: { 'content-type': 'application/json', 'content-length': data.length } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { /* not JSON */ } resolve({ status: res.statusCode, body: j }); });
    });
    q.on('error', reject);
    q.end(data);
  });
}

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/pricing', require(path.join(HERE, 'routes', 'pricing')));
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const port = server.address().port;

  let r = await price(port, [{ code: 'tea', qty: 10 }]);
  let line = r.body && r.body.lines && r.body.lines[0];
  t('priced-from-shelf: 200 and the tier price 90 at qty 10', [r.status, line && line.unit_price, line && line.tier && line.tier.qty], [200, 90, 10]);
  t('...with its sentence, two bands and a total of 900', [line && line.why, line && line.bands.length, r.body && r.body.total], ['tier from 10 → 90 each', 2, 900]);

  r = await price(port, [{ code: 'tea', qty: 9 }]);
  line = r.body && r.body.lines && r.body.lines[0];
  t('below-first-break: qty 9 is the list price 100', [r.status, line && line.unit_price, line && line.tier], [200, 100, null]);
  t('...and says why', line && line.why, 'below the first break (10) — list price');

  r = await price(port, [{ code: 'salt', qty: 3 }]);
  line = r.body && r.body.lines && r.body.lines[0];
  t('unpriced-is-null: no price is null, never 0 (D3)', [r.status, line && line.unit_price, line && line.why], [200, null, 'no price set']);
  t('...and adds nothing to the total', r.body && r.body.total, 0);

  server.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error = console.log; console.log(e); process.exit(1); });
