#!/usr/bin/env node
/**
 * api-ownerscope.test.cjs — SEC-117 (OWASP API3 mass assignment, API5 function-level authorisation): only the platform seat registers a network business owned by the PLATFORM.
 *
 * OWNS      the proof that POST /api/network/entities with ownerScope 'platform' is 403 NOT_PLATFORM (a registered code) for a shop owner, a staff seat and a caller with no identity,
 *           that the platform seat (the one role of lib/platformroot.js) still passes, and that the shop's own scopes ('entity', 'network', none) pass for everyone.
 * CALLED BY CI (tests/run-tests.js picks up *.test.cjs). No database, no network: the route's own gate found on the loaded app, behind a handler that answers 200.
 * FLOW      identity (set by the test) → the route's platformScopeOnly gate → 200 | 403 Problem NOT_PLATFORM
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const path = require('path');
const express = require('express');
const loader = require('../tools/load-app.cjs');
const CODES = new Set(require('../docs/error-codes.json').codes.map((row) => row.code));
loader.stubDatabase(path.join(__dirname, '..'));
const loaded = loader.loadApp(path.join(__dirname, '..'));
let gate = null;
loader.leavesOf(loaded, true).forEach((leaf) => {
  if (leaf.method + ' ' + leaf.path === 'POST /api/network/entities') gate = leaf.fns.find((fn) => fn && fn.name === 'platformScopeOnly') || gate;
});
let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log((ok ? 'ok     ' : 'FAILED ') + what);
};
const SHOP = '33333333-3333-4333-8333-333333333333';
const WHO = {
  'shop owner': { identity_id: SHOP, identity_type: 'entity' },
  'staff seat': { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor' },
  anonymous: null,
  'platform seat': { identity_id: '55555555-5555-4555-8555-555555555555', identity_type: 'entity', owner_scope: 'platform' }
};
async function post(identity, body) {
  const app = express();
  app.use(express.json());
  app.post('/e', (req, res, next) => { req.identity = identity || undefined; next(); }, gate, (req, res) => res.json({ ok: true }));
  const server = require('http').createServer(app).listen(0);
  try {
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}
(async () => {
  check(!!gate, 'the route carries the platform-scope gate');
  if (!gate) process.exit(1);
  for (const [who, identity] of Object.entries(WHO)) {
    const platform = who === 'platform seat';
    const asked = await post(identity, { name: 'Acme', ownerScope: 'platform' });
    if (platform) check(asked.status === 200, who + ' may set ownerScope platform');
    else check(asked.status === 403 && asked.body.code === 'NOT_PLATFORM' && CODES.has(asked.body.code) && !!asked.body.title, who + ' is refused ownerScope platform with 403 NOT_PLATFORM (got ' + asked.status + ')');
    for (const body of [{ name: 'Acme' }, { name: 'Acme', ownerScope: 'entity' }, { name: 'Acme', ownerScope: 'network' }]) {
      const ok = await post(identity, body);
      check(ok.status === 200, who + ' registers its own scope ' + JSON.stringify(body.ownerScope || 'default') + ' (got ' + ok.status + ')');
    }
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
