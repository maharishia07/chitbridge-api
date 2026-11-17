'use strict';
/**
 * tests/net-56-withdraw-earlier-end.test.cjs — NET-56 (owner cb-network, decided 6 Nov, ATHI-DECISIONS): a second POST /api/network-offers/:id/withdraw keeps the EARLIER end.
 * OWNS      first withdraw: the asked end is stored and answered; a second withdraw with a LATER end answers 200 with the earlier end that holds and does not move the record;
 *           a second withdraw with an EARLIER end brings the end forward; withdrawn_at stays the first withdraw's stamp. An offer released with an `until` and withdrawn once is a FIRST withdraw.
 * CALLED BY scripts/guards.cjs. Reuses routes/network-offers.js and lib/network-offers.earlierEnd. No DB, no network.
 * CARD      network-and-trade/network-offers
 * Run: node tests/net-56-withdraw-earlier-end.test.cjs
 */
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
const ROOT = path.join(__dirname, '..');
const OFFER = '00000000-0000-4000-8000-0000000000c1';
const BRAND = '00000000-0000-4000-8000-0000000000b1';
const stub = (file, exports) => { const id = require.resolve(path.join(ROOT, file)); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const run = async () => ({ rows: [{ definition_id: OFFER, name: 'Deal', status: 'live', current_version: 1 }] });
const dbReal = require(path.join(ROOT, 'db'));
stub('db', { ...dbReal, query: run, withEntity: async (id, fn) => fn({ query: run }) });
const authId = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const authStub = (req, res, next) => { req.identity = { identity_id: BRAND, identity_type: 'entity' }; req.entityId = BRAND; next(); };
Object.assign(authStub, { entityOf: () => BRAND, requireRole: () => (req, res, next) => next(), requireIdentity: authStub });
require.cache[authId] = { id: authId, filename: authId, loaded: true, exports: authStub };
const net = require(path.join(ROOT, 'lib', 'network-offers'));
let record;
let written;
net.flagsOf = async () => ({ flags: { network_offers: { released: { [OFFER]: record } } } });
net.setReleased = async (me, id, rec) => { written = rec; record = rec; };
net.pushToNetwork = async () => ({ stores: 0, clients: 0 });
net.nextOpeningFor = async () => '2026-12-01T00:00:00.000Z';
require.cache[require.resolve(path.join(ROOT, 'lib', 'owner'))] = { id: 'x', filename: 'x', loaded: true, exports: { ownerOnly: () => (req, res, next) => next() } };

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' :: ' + detail)); };
const post = (server, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const req = http.request({ port: server.address().port, path: '/api/network-offers/' + OFFER + '/withdraw', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} }));
  });
  req.on('error', reject);
  req.end(data);
});

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/network-offers', require(path.join(ROOT, 'routes', 'network-offers.js')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    record = { version: 1, at: '2026-10-01T00:00:00.000Z', until: '2026-12-31T00:00:00.000Z' };
    const first = await post(server, { at: '2026-11-20T00:00:00.000Z' });
    check('released with an until, withdrawn once: a FIRST withdraw, the asked end holds', first.status === 200 && first.body.until === '2026-11-20T00:00:00.000Z' && !!written.withdrawn_at, first.status + ' ' + JSON.stringify(first.body));
    const stamp = written.withdrawn_at;
    const later = await post(server, { at: '2026-12-31T00:00:00.000Z' });
    check('a second withdraw "at 31 Dec" answers 200 with the EARLIER end that holds', later.status === 200 && later.body.until === '2026-11-20T00:00:00.000Z', later.status + ' ' + JSON.stringify(later.body));
    check('the record end did not move later, withdrawn_at is the first one', written.until === '2026-11-20T00:00:00.000Z' && written.withdrawn_at === stamp, JSON.stringify(written));
    const sooner = await post(server, { at: '2026-11-10T00:00:00.000Z' });
    check('a second withdraw with an earlier end brings the end forward', sooner.status === 200 && sooner.body.until === '2026-11-10T00:00:00.000Z' && written.until === '2026-11-10T00:00:00.000Z', sooner.status + ' ' + JSON.stringify(sooner.body));
  } finally {
    server.close();
  }
  say(failed ? failed + ' FAILED' : 'all ok');
  process.exit(failed ? 1 : 0);
})().catch((e) => { say('FAIL crashed :: ' + (e && e.stack || e)); process.exit(1); });
