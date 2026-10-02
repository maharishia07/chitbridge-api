/**
 * tests/support/books-manual-rig.cjs — the shared rig of tests/books-preview.test.cjs and tests/books-manual-events.test.cjs: real express, a stand-in auth, the
 * in-memory store (books-harness), the shop's day pinned to 2026-10-10 (FY 2026-27, month 7), a shop with the ledger on, two parties, and one staff ledger.
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./books-harness.cjs');

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor' };
let WHO = OWNER;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

/** → { X, q, asOwner, asStaff, srv, staff: { code }, close } or null (with the reason printed) when the engines are not there */
async function rig() {
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return null; }
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? '2026-10-10' : realDay(ts, c));   /* only "now" moves */
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  const en = await q('POST', '/enable', {});
  if (!en.body.ok) throw new Error('could not enable the ledger: ' + JSON.stringify(en.body));
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 });
  return { X, q, srv, SHOP, CUST, SUPP, asOwner: () => { WHO = OWNER; }, asStaff: () => { WHO = STAFF; }, close: () => srv.close() };
}
/** a ledger the shop adds for one employee, under Loans & Advances (Asset) — through the real POST /accounts */
async function addStaffLedger(R, name) {
  const accs = await R.q('GET', '/accounts');
  const grp = accs.body.accounts.find((a) => a.is_group && a.name === 'Loans & Advances (Asset)');
  const r = await R.q('POST', '/accounts', { name, parent_code: grp.code });
  return r.body.account;
}
function counter() {
  let pass = 0, fail = 0;
  const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
  const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
  const done = () => { console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks'); process.exit(fail ? 1 : 0); };
  return { ok, eq, done };
}
module.exports = { rig, addStaffLedger, counter, SHOP, CUST, SUPP };
