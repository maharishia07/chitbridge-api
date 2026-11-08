#!/usr/bin/env node
// @type: contract
/**
 * api-43-pricing-tolerant.test.cjs — API-43 (Athi, 8 Nov 2026): POST /api/pricing/price is keyed outward, so an unknown body key is IGNORED until a /v2 path with notice.
 *
 * OWNS      the tolerance: an unknown key leaves the answer unchanged (it answered 422 from API-8 9d0114f8 until this PR); a body of the wrong kind is still refused in the problem shape.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route over the stand-in world (tests/lib/problem-world.cjs).
 * FLOW      lines (+ one zz_unknown_field) → real route → status + body, compared with the same call without the key
 * CARD      28-platform-and-operations/pricing-service
 */
'use strict';
const path = require('path');
const express = require('express');
const { harness } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const lab = harness({ here: HERE, mounts: ['/api/pricing'], routeFiles: { '/api/pricing': 'routes/pricing.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { world, check } = lab;
const LINE = { key: 'k', qty: 10, listPrice: 10, pricing: { kind: 'tiered', tiers: [{ qty: 10, price: 8 }] } };

(async () => {
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  app.use(express.json());
  app.use('/api/pricing', require(path.join(HERE, 'routes', 'pricing.js')));
  const server = app.listen(0);
  const port = server.address().port;
  Object.assign(world, { realAuth: false, asKey: false, db: 'ok', sqlRows: null });
  try {
    const plain = await lab.send(port, 'POST', '/api/pricing/price', { lines: [LINE] });
    const extra = await lab.send(port, 'POST', '/api/pricing/price', { lines: [LINE], zz_unknown_field: 1, currency: 'INR' });
    check('plain call answers 200, total 80', plain.status === 200 && plain.json.total === 80, plain.json);
    check('an unknown key is ignored: 200 and the answer is unchanged', extra.status === 200 && JSON.stringify(extra.json) === JSON.stringify(plain.json), extra.json);
    const wrong = await lab.send(port, 'POST', '/api/pricing/price', [LINE]);
    check('a body of the wrong kind (a list) is still refused with the problem shape', wrong.status === 422 && wrong.json && wrong.json.code && wrong.json.status === 422, wrong.json);
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
