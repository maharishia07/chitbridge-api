/**
 * ⭐ A PARTY IS NUMBERED WHEN IT IS ADDED (Athi, 2026-10-02: "each customer / supplier will have a customer id, and it should
 * be used in ledger"). Before, party-fields.ensureNo ran only on a field save, books setup or the nightly job — a customer
 * added today had no number until tonight. NET-40 (2026-10-25): a business on the rail is no longer ADDED but INVITED; it is numbered when it
 * accepts (lib/customer-invite, tests/net-40-consent.test.cjs). This test holds the invitation's answer, and that an unreachable business is refused in words.
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
const SENT = [];
require(path.join(API, 'lib', 'customer-invite')).setSender(async (seller, body) => { SENT.push({ seller, body }); return { ok: true, status: 200, body: { chit_id: 'CHIT-1' } }; });
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
    console.log('\n== A BUSINESS ON THE RAIL IS INVITED (NET-40): numbered when it accepts, not when it is asked ==\n');
    const a = await add();
    ok('Add customer by handle answers 200 INVITED, with the words and the chit', a.status === 200 && a.body.invited === true && a.body.chit_id === 'CHIT-1' && /Invitation sent\. They become your customer when they accept\./.test(a.body.message || ''), a.status + ' ' + JSON.stringify(a.body));
    ok('...no customer is claimed and nobody is numbered yet (the number comes with the customer, at their Accept: tests/net-40-consent.test.cjs)', a.body.customer === undefined && NUMBERED.length === 0, JSON.stringify(a.body) + JSON.stringify(NUMBERED));
    ok('...the invitation went from THIS shop to THAT business as an ordinary general chit', SENT.length === 1 && SENT[0].seller === SHOP && SENT[0].body.purpose === 'general' && SENT[0].body.recipients[0].entity_id === CUST, JSON.stringify(SENT));
    TRADE = { ok: false, why: 'Chola Auto Care is in the test sandbox and this shop is in live' };
    const b = await add();
    ok('a business in another sandbox cannot be invited: 409 in words with the reason, nothing sent', b.status === 409 && b.body.code === 'CUSTOMER_INVITE_UNREACHABLE' && /sandbox/.test(b.body.message || b.body.detail || '') && SENT.length === 1, JSON.stringify(b.body));
  } finally { srv.close(); }
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  if (fail) process.exitCode = 1;
})();
