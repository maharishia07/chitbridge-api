#!/usr/bin/env node
// @type: contract
/**
 * rail146l-suppliers-cost-blind.test.cjs — RAIL-146l: GET /api/relationships/suppliers puts balance_minor on a supplier row only for a reader who may see costs.
 *
 * OWNS      the proof that the supplier list follows lib/dues-view R2 (what the shop owes a supplier: balance_minor null + cost_hidden:true for a co-assist
 *           without can_see_costs); the owner and a cost-allowed co-assist get the figure as before; a ledger-off row (no balance_minor) stays without one.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route over a stand-in sign-in, a one-row list and a planted balance.
 * FLOW      sign in as owner | blind actor | cost-allowed actor → GET /suppliers → the row's balance_minor / cost_hidden
 * MIN       contract - blind: null + cost_hidden; owner and allowed: the planted figure; ledger off: key absent.
 * CARD      11-crm-and-marketing/relationships-routes
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const ROOT = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const SUP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FIGURE = -4242500;
const LIMIT = 7654321; /* the supplier's credit limit (party field, any ledger state) */
const stub = (rel, exports) => {
  const file = require.resolve(path.join(ROOT, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const row = () => ({ supplier_list_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', supplier_entity_id: SUP, display_name: 'Tea man', on_rail: false, user_id: '~s.sup-1', policy_flags: {}, gstn: null });
const run = async () => ({ rows: [row()], rowCount: 1 });
const handle = { query: run, connect: async () => ({ query: run, release() {} }) };
stub('db', { query: run, pool: handle, withEntity: async (id, fn) => fn(handle), trySavepoint: async (h, fn) => fn() });
let ledgerOn = true,
  seen = 'owner';
const WHO = {
  owner: { identity_id: SHOP, identity_type: 'entity' },
  blind: { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor' },
  allowed: { identity_id: '55555555-5555-4555-8555-555555555555', parent_entity_id: SHOP, identity_type: 'actor' }
};
const auth = (req, res, next) => ((req.identity = WHO[seen]), next());
auth.entityOf = () => SHOP;
stub(path.join('middleware', 'auth'), auth);
stub(path.join('lib', 'party-fields'), { decorate: async (w, o, rows) => (rows.forEach((r) => { r.credit_limit_minor = LIMIT; if (ledgerOn) r.balance_minor = FIGURE; }), rows), ensureNo: async () => null });
stub(path.join('lib', 'cost'), { isCostBlind: async (req) => req.identity.identity_type === 'actor' && req.identity === WHO.blind });
const app = express();
app.use(express.json());
app.use('/api/relationships', require(path.join(ROOT, 'routes', 'relationships.js')));
let failed = 0;
const check = (ok, label) => (console.log((ok ? 'ok   ' : 'FAIL ') + label), ok || failed++);
const get = (server) =>
  new Promise((resolve) => http.get({ port: server.address().port, path: '/api/relationships/suppliers' }, (r) => { let t = ''; r.on('data', (c) => (t += c)); r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(t) })); }));
(async () => {
  const server = app.listen(0);
  seen = 'blind';
  let a = await get(server);
  check(a.status === 200 && a.body.suppliers[0].balance_minor === null && a.body.suppliers[0].cost_hidden === true, 'a cost-blind login: balance_minor null + cost_hidden:true');
  check(!JSON.stringify(a.body).includes(String(Math.abs(FIGURE))), 'a cost-blind login: the figure is nowhere in the body');
  check(a.body.suppliers[0].credit_limit_minor === null && !JSON.stringify(a.body).includes(String(LIMIT)), 'a cost-blind login: the supplier credit limit is null (dues-view R5, the CRM record rule)');
  for (const who of ['owner', 'allowed']) {
    seen = who;
    a = await get(server);
    check(a.status === 200 && a.body.suppliers[0].balance_minor === FIGURE && a.body.suppliers[0].cost_hidden === undefined && a.body.suppliers[0].credit_limit_minor === LIMIT, who + ': the figure and the credit limit as before');
  }
  seen = 'blind';
  ledgerOn = false;
  a = await get(server);
  check(a.status === 200 && !('balance_minor' in a.body.suppliers[0]) && a.body.suppliers[0].credit_limit_minor === null, 'ledger off, cost-blind: no balance key, the credit limit still hidden');
  server.close();
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
