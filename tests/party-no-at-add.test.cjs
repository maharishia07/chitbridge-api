/**
 * ⭐ A PARTY IS NUMBERED WHEN IT IS ADDED (Athi, 2026-10-02: "each customer / supplier will have a customer id, and it should
 * be used in ledger"). Before, party-fields.ensureNo ran only on a field save, books setup or the nightly job — a customer
 * added today had no number until tonight. And the add says whether bills can reach them (lib/istest mayTrade).
 * No database: db, auth, party-fields.ensureNo and istest.mayTrade are stubbed; the route is the real one.
 * Run: node tests/party-no-at-add.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
let NUMBERED = [];
const tx = { query: async (s) => ({ rows: /RETURNING customer_list_id/.test(String(s)) ? [{ customer_list_id: 'CL-1' }] : [] }) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s) => ({ rows: /FROM identities/.test(String(s)) ? [{ identity_id: CUST, display_name: 'Chola Auto Care', user_id: 'chola', bridge_id: 'CB-CUST' }] : [] }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (req) => req.identity }) };
const pf = require(path.join(API, 'lib', 'party-fields'));
pf.ensureNo = async (db, owner, id) => { NUMBERED.push([owner, id]); return 'P-0042'; };
let TRADE = { ok: true };
require(path.join(API, 'lib', 'istest')).mayTrade = async () => TRADE;

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/relationships', require(path.join(API, 'routes', 'relationships')));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  const srv = app.listen(0); const port = srv.address().port;
  const add = async () => { const r = await fetch('http://127.0.0.1:' + port + '/api/relationships/customers', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: 'chola' }) }); return { status: r.status, body: await r.json() }; };
  try {
    console.log('\n══ A PARTY IS NUMBERED WHEN IT IS ADDED ══\n');
    const a = await add();
    ok('Add customer answers 200 with the new party number', a.status === 200 && a.body.customer && a.body.customer.party_no === 'P-0042', a.status + ' ' + JSON.stringify(a.body));
    ok('…numbered through party-fields.ensureNo, for THIS shop and THIS customer (the one numbering path)', NUMBERED.length === 1 && NUMBERED[0][0] === SHOP && NUMBERED[0][1] === CUST, JSON.stringify(NUMBERED));
    ok('…and a customer bills can reach is marked on ChitBridge, with no one-sided note', a.body.customer.on_rail === true && !a.body.customer.one_sided, JSON.stringify(a.body.customer));
    TRADE = { ok: false, why: 'Chola Auto Care is in the test sandbox and this shop is in live' };
    const b = await add();
    ok('a customer in another sandbox is still added — and told: "bills to them stay here only" with the reason', b.status === 200 && /stay here only: Chola Auto Care is in the test sandbox/.test(b.body.message || '')
      && b.body.customer.on_rail === false && b.body.customer.one_sided && /sandbox/.test(b.body.customer.one_sided.why), JSON.stringify(b.body));
    pf.ensureNo = async () => { throw new Error('no series yet (before b272)'); };
    const c = await add();
    ok('numbering that cannot run never fails the add (party_no null; the nightly job catches up)', c.status === 200 && c.body.customer.party_no === null, c.status + ' ' + JSON.stringify(c.body));
  } finally { srv.close(); }
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  if (fail) process.exitCode = 1;
})();
