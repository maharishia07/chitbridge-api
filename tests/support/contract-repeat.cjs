/**
 * tests/support/contract-repeat.cjs — the /api/repeat routes the web reads (CB Finance › Repeat supply, the chit sheet's Accept · Counter ·
 * Decline · Skip), called THROUGH REAL EXPRESS over the in-memory table and the stand-in send (tests/support/repeat-supply-memory.cjs), each
 * answer kept under "METHOD /api/repeat/<route pattern>". Used by tests/web-api-contract.test.cjs, which holds each answer to docs/contracts/web-api.json.
 * The scenario is tests/repeat-supply.test.cjs's own: a sent invoice repeated weekly, countered by the customer, agreed, run, skipped, paused, ended.
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./books-harness.cjs');
const { memory } = require('./repeat-supply-memory.cjs');

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const CUSTOMER = { identity_id: CUST, identity_type: 'entity', display_name: 'Ravi Stores' };
let WHO = OWNER;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

async function captureRepeat() {
  const got = {};
  const keep = (m, key, r) => { let k = m + ' /api/repeat' + key; if (got[k] && got[k].status !== r.status) k += ' #' + r.status; got[k] = got[k] || { status: r.status, bodies: [] }; got[k].bodies.push(r.body); return r; };
  H.load({ auth: authStub });
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock'));
  const R = require(path.join(H.API, 'lib', 'repeat-supply'));
  const mem = memory(); mem.migrated = true; R.use(mem.store); R.useSender(mem.sendAs);
  R.useMover(async (entity, chit_id, status) => ({ code: 200, moved: true, body: { chit_id, status } }));
  const app = express(); app.use(express.json()); app.use('/api/repeat', require(path.join(H.API, 'routes', 'repeat-supply')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/repeat' + p, b);
  try {
    CLOCK.set('2026-10-05T06:00:00Z');
    const INV = 'bbbbbbbb-0000-4000-8000-000000000001';
    mem.hold(INV, SHOP, CUST, { purpose: 'invoice', line_items: [{ line_id: 'L1', seq: 10, particulars: 'Milk 1L', quantity: 20, price: 50, total: 1000 }], summary_json: { currency_code: 'INR', money: { total: 1180 } } });
    WHO = OWNER;
    const c1 = keep('POST', '', await q('POST', '/', { chit_id: INV, unit: 'weekly', every: 1, start_on: '2026-10-06', until: { runs: 3 }, mode: 'draft' }));
    const A = c1.body.agreement.agreement_id, AC = c1.body.agreement.chit_id;
    keep('GET', '/:id', await q('GET', '/' + A));
    WHO = CUSTOMER;
    keep('GET', '/:id', await q('GET', '/' + A + '?chit=' + AC));
    keep('POST', '/:id/accept', await q('POST', '/' + A + '/accept', { chit_id: AC }));
    keep('POST', '/:id/counter', await q('POST', '/' + A + '/counter', { chit_id: AC, lines: [{ line_id: 'L1', quantity: 15 }], every: 2, unit: 'weekly', start_on: '2026-10-13', note: 'Fortnightly, fifteen' }));
    keep('POST', '/:id/accept', await q('POST', '/' + A + '/accept', { chit_id: AC }));          /* #422: a counter is open */
    WHO = OWNER;
    keep('POST', '/:id/agree', await q('POST', '/' + A + '/agree', {}));
    keep('POST', '/:id/pause', await q('POST', '/' + A + '/pause', { reason: 'Stock out' }));
    keep('POST', '/:id/resume', await q('POST', '/' + A + '/resume', {}));
    CLOCK.set('2026-10-14T06:00:00Z');
    keep('POST', '/:id/run', await q('POST', '/' + A + '/run', {}));
    WHO = CUSTOMER;
    keep('POST', '/:id/skip', await q('POST', '/' + A + '/skip', { chit_id: AC, reason: 'Shop shut for Diwali' }));
    WHO = OWNER;
    keep('POST', '/sweep', await q('POST', '/sweep', {}));
    keep('POST', '/:id/end', await q('POST', '/' + A + '/end', { reason: 'Customer moved' }));
    /* a second one: accepted plainly, then declined by the customer; a third: refused by the seller */
    const c2 = keep('POST', '', await q('POST', '/', { chit_id: INV, unit: 'monthly', start_on: '2026-10-31', mode: 'send' }));
    const B = c2.body.agreement.agreement_id, BC = c2.body.agreement.chit_id;
    WHO = CUSTOMER;
    keep('POST', '/:id/accept', await q('POST', '/' + B + '/accept', { chit_id: BC }));
    keep('POST', '/:id/decline', await q('POST', '/' + B + '/decline', { chit_id: BC, reason: 'Too often' }));
    WHO = OWNER;
    const c3 = keep('POST', '', await q('POST', '/', { chit_id: INV, unit: 'daily', every: 2, start_on: '2026-10-15' }));
    const C = c3.body.agreement.agreement_id, CC = c3.body.agreement.chit_id;
    WHO = CUSTOMER; await q('POST', '/' + C + '/counter', { chit_id: CC, every: 3, unit: 'daily', start_on: '2026-10-16', note: 'Every third day' });
    WHO = OWNER;
    keep('POST', '/:id/refuse', await q('POST', '/' + C + '/refuse', { reason: 'Two days or nothing' }));
    keep('GET', '', await q('GET', '/'));
    mem.migrated = false;
    keep('GET', '', await q('GET', '/'));
    keep('POST', '', await q('POST', '/', { chit_id: INV, unit: 'weekly', start_on: '2026-10-20' }));   /* 503 before b300 */
  } finally { srv.close(); CLOCK.reset(); R.use(null); R.useSender(null); R.useMover(null); }
  return got;
}
module.exports = { captureRepeat };
