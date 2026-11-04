#!/usr/bin/env node
/**
 * offers-route-answers.test.cjs — CAT-220 (W45 100% target): the offer engine's explain, tested THROUGH THE ROUTE (routes/offers.js).
 *
 * OWNS      the answers of POST /api/offers/evaluate and /explain that the api-problem sweep cannot see (it checks the shape of a refusal, not the sum):
 *           the 400 with no lines · "why" + amount + scope + target of a percent-off · an expired offer is skipped with a reason and nothing is explained ·
 *           a key without the offers scope is refused 403 · no offers in the body = the shop's own live shelf (offers_considered).
 * CALLED BY by hand and CI (not in the offline gate: it takes the real express router over a stand-in auth and db). No database, no network.
 * FLOW      real routes/offers.js + the real offers engine + real middleware/auth.requireScope  ←  stub identity / key / catalogue-view.liveOffers
 *
 * The cases assert the legacy {error,message} body the route answers today (routes/offers.js:66); when lib/offers-contract.js grows its Problem
 * rows (API-8) the legacy keys stay frozen in docs/contracts/api-legacy.json.
 * Run: node tests/offers-route-answers.test.cjs
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
const world = { key: null };
const realAuth = require(path.join(HERE, 'middleware', 'auth'));
/* the identity and the key are stood in; requireScope, the thing under test for the 403, is the REAL one */
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
  if (world.key) req.api_key = { jti: 'j1', scopes: world.key };
  next();
};
mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.identity_id }));
const db = { query: async () => ({ rows: [] }), withEntity: async (id, run) => run({ query: async () => ({ rows: [] }) }) };
mock('db', db);
mock('db/index', db);
console.error = () => undefined;
console.warn = () => undefined;

/* the shop's live shelf: one 15% offer, so "offers omitted" has something to read */
let shelfReads = 0;
const catalogueView = require(path.join(HERE, 'lib', 'catalogue-view'));
catalogueView.liveOffers = async () => {
  shelfReads++;
  return [{ id: 'shelf', kind: 'percent_off', percent: 15 }];
};

function post(port, route, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const q = http.request({ host: '127.0.0.1', port, method: 'POST', path: route, headers: { 'content-type': 'application/json', 'content-length': data.length } }, (res) => {
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
  app.use('/api/offers', require(path.join(HERE, 'routes', 'offers')));
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const port = server.address().port;
  const lines = [{ key: 'a', qty: 2, unitPrice: 100 }];

  let r = await post(port, '/api/offers/evaluate', {});
  t('evaluate-no-lines: 400, and the legacy keys are still there', [r.status, r.body && r.body.error, !!(r.body && r.body.message)], [400, 'validation', true]);

  r = await post(port, '/api/offers/explain', { lines, offers: [{ id: 'o', kind: 'percent_off', percent: 10 }] });
  const e0 = r.body && r.body.explain && r.body.explain[0];
  t('explain-says-why: 200 and a total of 180', [r.status, r.body && r.body.total], [200, 180]);
  t('explain[0] = label, why "10% off ...", amount -20, scope line, target a', [!!(e0 && e0.label), /^10% off/.test((e0 && e0.why) || ''), e0 && e0.amount, e0 && e0.scope, e0 && e0.target], [true, true, -20, 'line', 'a']);

  r = await post(port, '/api/offers/explain', { lines, offers: [{ id: 'old', kind: 'percent_off', percent: 10, valid_to: '2020-01-01' }] });
  t('explain-skipped-says-why: an expired offer is skipped, its why starts "expired", nothing is explained', [r.status, r.body.explain, /^expired/.test((r.body.skipped[0] || {}).why || '')], [200, [], true]);

  world.key = ['till'];
  r = await post(port, '/api/offers/evaluate', { lines });
  t('evaluate-key-not-scoped: a key without the offers scope is refused 403', r.status, 403);
  world.key = ['offers'];
  r = await post(port, '/api/offers/evaluate', { lines, offers: [{ id: 'o', kind: 'percent_off', percent: 10 }] });
  t('...and a key with the offers scope is let in', r.status, 200);
  world.key = null;

  shelfReads = 0;
  r = await post(port, '/api/offers/evaluate', { lines });
  t('offers-omitted-reads-live-shelf: the shop\'s own shelf is read once and counted', [r.status, shelfReads, r.body.offers_considered, r.body.total], [200, 1, 1, 170]);

  server.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error = console.log; console.log(e); process.exit(1); });
