#!/usr/bin/env node
/**
 * tests/sec-149-soft-token.test.cjs — SEC-149: a public door that serves MORE to the owner (GET /api/catalogue/:bridge?preview=1, the
 * sign-in-first gate, CB Assist grounding) asks middleware/auth.softIdentity, which runs the SAME credential decision auth runs.
 *
 * Proved against the REAL routes/catalogue.js and the REAL middleware/auth.js; only the database and the catalogue view are stand-ins.
 *   a. a signed-out (revoked jti) owner token previewing a PRIVATE shop    → 404, the same as a stranger (before SEC-149: the full catalogue)
 *   b. a switched-off co-assist                                            → 404
 *   c. a cost-blind co-assist (can_see_costs false)                        → previews, but no cost key anywhere in the answer
 *   d. the owner's live session, and a co-assist with can_see_costs        → previews, cost kept as the view built it
 *   e. no route or lib file keeps a second `verifyJwt(` soft reader (the allowed list is named below)
 * Run: node tests/sec-149-soft-token.test.cjs · no network beyond 127.0.0.1, no DB.
 * CARD 18-identity-sign-in-and-access/sessions-and-devices
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-sec149';
process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');
const NOW = Math.floor(Date.now() / 1000);
const SHOP = '11111111-1111-4111-8111-111111111111';
const ROWS = {
  [SHOP]: { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop One', bridge_id: 'BR-ONE', user_id: 'shopone', status: 'active', policy_flags: { devices: { dev12345: { sessions: [{ jti: 'live-jti', exp: NOW + 3600 }] } } } },
  off: { identity_id: 'off', identity_type: 'actor', break_status: 'deactivated', hat: 'act', can_see_costs: true },
  blind: { identity_id: 'blind', identity_type: 'actor', break_status: 'active', hat: 'act', can_see_costs: false },
  sees: { identity_id: 'sees', identity_type: 'actor', break_status: 'active', hat: 'act', can_see_costs: true }
};
const q = async (sql, params) => {
  const s = String(sql);
  if (/information_schema\.columns/.test(s)) return { rows: [{ '?column?': 1 }] };
  if (/SELECT policy_flags FROM identities/.test(s)) return { rows: [{ policy_flags: ROWS[params[0]].policy_flags || {} }] };
  if (/break_status/.test(s)) return { rows: ROWS[params[0]] && ROWS[params[0]].identity_type === 'actor' ? [ROWS[params[0]]] : [] };
  if (/FROM identities/.test(s) && /bridge_id = \$1/.test(s)) return { rows: [ROWS[SHOP]] };
  return { rows: [] };
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: q, withEntity: async (_e, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), trySavepoint: async (_d, fn) => fn(), pool: { query: q } } };
/* the view: a private shop is shown to the owner only, and the stand-in builds a cost key into it (so the cost-blind strip is what is tested) */
const viewPath = require.resolve(path.join(API, 'lib', 'catalogue-view'));
const real = require(viewPath);
const view = (o) => (o.asOwner ? { available: true, shop: { name: 'Shop One' }, items: [{ name: 'Tussar', price: 500, item_data: { cost: 380, unit_cost: 370 } }], visibility: 'private' } : { available: false });
require.cache[viewPath].exports = Object.assign({}, real, { buildPublicView: async (o) => view(o) });

const auth = require(path.join(API, 'middleware', 'auth'));
const app = express();
app.use('/api/catalogue', require(path.join(API, 'routes', 'catalogue')));
const sign = (c) => jwt.sign(c, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: 3600 });
const T = {
  owner: sign({ identity_id: SHOP, identity_type: 'entity', jti: 'live-jti', device_id: 'dev12345' }),
  signedOut: sign({ identity_id: SHOP, identity_type: 'entity', jti: 'revoked-jti', device_id: 'dev12345' }),
  off: sign({ identity_id: 'off', identity_type: 'actor', parent_entity_id: SHOP }),
  blind: sign({ identity_id: 'blind', identity_type: 'actor', parent_entity_id: SHOP }),
  sees: sign({ identity_id: 'sees', identity_type: 'actor', parent_entity_id: SHOP })
};
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? '  ok  ' : '  FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(extra))); };

function get(port, urlPath, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-device-id': 'dev12345' };
    if (token) headers.authorization = 'Bearer ' + token;
    http.get({ port, host: '127.0.0.1', path: urlPath, headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, text: b }));
    }).on('error', reject);
  });
}
(async () => {
  const server = app.listen(0); const port = server.address().port;
  const P = '/api/catalogue/BR-ONE?preview=1';
  console.log('SEC-149 · soft token reader');
  const stranger = await get(port, P, null);
  ok('a stranger gets 404 for the private shop', stranger.status === 404, stranger);
  const bad = await get(port, P, 'not-a-token');
  ok('a bad token is a stranger', bad.status === 404, bad);
  const out = await get(port, P, T.signedOut);
  ok('(a) a signed-out owner token (revoked jti) previews NOTHING', out.status === 404, out);
  const off = await get(port, P, T.off);
  ok('(b) a switched-off co-assist previews NOTHING', off.status === 404, off);
  const blind = await get(port, P, T.blind);
  ok('(c) a cost-blind co-assist previews, with no cost key in the answer', blind.status === 200 && !/cost/i.test(blind.text), blind);
  const owner = await get(port, P, T.owner);
  ok('(d) the owner live session previews the private catalogue', owner.status === 200 && /Tussar/.test(owner.text), owner);
  ok('(d) the owner keeps what the view built (cost not stripped by the cost-blind rule)', /"cost":380/.test(owner.text), owner.text);
  const sees = await get(port, P, T.sees);
  ok('(d) a co-assist WITH can_see_costs previews and keeps it', sees.status === 200 && /"cost":380/.test(sees.text), sees);
  if (auth.softIdentity) {
    const soft = await auth.softIdentity({ headers: { authorization: 'Bearer ' + T.blind, 'x-device-id': 'dev12345' } });
    ok('softIdentity names the co-assist with can_see_costs false from the DATABASE', soft && soft.can_see_costs === false && soft.hat === 'act', soft);
  } else ok('softIdentity exists', false, 'missing');
  server.close();

  /* e. the allowed list: every other bearer read in routes/ and lib/ goes through auth.softIdentity or customerAuth.soft */
  const ALLOWED = new Set(['middleware/auth.js', 'middleware/customer-auth.js', 'middleware/idempotency.js', 'lib/limiter-key.js', 'lib/jwt-verify.js']);
  const found = [];
  for (const dir of ['routes', 'lib', 'middleware']) {
    for (const f of fs.readdirSync(path.join(API, dir))) {
      if (!f.endsWith('.js') && !f.endsWith('.cjs')) continue;
      const rel = dir + '/' + f;
      if (!ALLOWED.has(rel) && /\bverifyJwt\(/.test(fs.readFileSync(path.join(API, rel), 'utf8').replace(/\/\/.*$/gm, ''))) found.push(rel);
    }
  }
  ok('(e) no route or lib file keeps its own verifyJwt( soft reader', found.length === 0, found);
  console.log('\n  ' + (pass + fail) + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
