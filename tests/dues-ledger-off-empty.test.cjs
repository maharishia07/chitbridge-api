/**
 * dues-ledger-off-empty.test.cjs — WALK S S-F-07: GET /api/books/dues for a shop whose ledger is not switched on answers 200 with the empty list
 * (nobody owes anybody yet), not a 404 the page reads as a failing call. Other books reads keep their 404 LEDGER_OFF. Offline.
 * Run: node tests/dues-ledger-off-empty.test.cjs
 */
'use strict';
const path = require('path'), http = require('http');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111';
const owner = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' };
const auth = Object.assign((req, res, next) => { req.identity = owner; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, p) => new Promise((done) => {
  http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { 'Identity-Type': 'entity' } }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => done({ status: res.statusCode, body: (() => { try { return JSON.parse(raw); } catch (_) { return null; } })() })); }).end();
});
(async () => {
  if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth });
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  try {
    const both = await call(port, '/api/books/dues');
    ok('ledger off: dues is 200, not 404', both.status === 200, 'status ' + both.status + ' ' + JSON.stringify(both.body));
    ok('the empty answer: no parties, total 0, both needs present', both.body && Array.isArray(both.body.parties) && both.body.parties.length === 0 && both.body.total_minor === 0 && both.body.needs && both.body.needs.customer && both.body.needs.supplier, JSON.stringify(both.body));
    const one = (await call(port, '/api/books/dues?side=customer')).body;
    ok('a side not asked for stays null, never zero', one && one.needs && one.needs.customer && one.needs.supplier === null, JSON.stringify(one));
    const pl = await call(port, '/api/books/pl');
    ok('another books read keeps its 404 while the ledger is off', pl.status === 404, 'status ' + pl.status);
  } finally { srv.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
