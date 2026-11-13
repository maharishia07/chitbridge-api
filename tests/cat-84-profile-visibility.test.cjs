#!/usr/bin/env node
/**
 * cat-84-profile-visibility.test.cjs — CAT-84 (proof 2026-11-14): PATCH /api/entities/profile saves identities.catalogue_visibility.
 * @type regression
 * OWNS      the proof that the Settings control's write lands: the owner sending catalogue_visibility 'private' / 'network' reaches
 *           UPDATE identities SET catalogue_visibility=$1 WHERE identity_id=$2 with that value and the shop's id, the default schema follows
 *           (entity_schemas.visibility), a value outside public|private|network writes nothing, and a profile save without the key leaves it alone.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route over a stand-in db and auth (the shape of tests/ctr182-gstin-owner-only.test.cjs).
 * FLOW      owner → PATCH /api/entities/profile { catalogue_visibility } → the UPDATE statements the db saw
 *   node tests/cat-84-profile-visibility.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { API, ok, done, mock, standInDb, call } = require('./lib/cat-proof-kit.cjs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const SHOP = '11111111-1111-4111-8111-111111111111';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Kaveri Mess' };

const { db, calls } = standInDb((sql) => {
  if (/FROM identities/.test(sql)) return { rows: [{ display_name: 'Kaveri Mess', identity_id: SHOP, country: 'IN', gstn: null, policy_flags: {}, params_override: {}, plan: 'free' }] };
  return { rows: [], rowCount: 1 };
});
const realAuth = require(path.join(API, 'middleware', 'auth'));
mock('middleware/auth', Object.assign((req, res, next) => { req.identity = OWNER; next(); }, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n() }));
mock('db', db); mock('db/index', db);
const realErr = console.error, realWarn = console.warn;
console.error = () => undefined; console.warn = () => undefined;
const visWrites = () => calls.filter((c) => /^\s*UPDATE identities SET catalogue_visibility/i.test(c.sql));
const schemaWrites = () => calls.filter((c) => /UPDATE entity_schemas SET visibility/i.test(c.sql));

(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/entities', require(path.join(API, 'routes', 'entities.js')));
  const server = app.listen(0); const port = server.address().port;
  const patch = async (body) => { calls.length = 0; return call(port, 'PATCH', '/api/entities/profile', body); };
  try {
    const priv = await patch({ catalogue_visibility: 'private' });
    console.error = realErr; console.warn = realWarn;
    const w = visWrites();
    ok('owner sets private: 200 and one UPDATE identities SET catalogue_visibility = private for this shop', priv.status === 200 && w.length === 1 && w[0].params[0] === 'private' && w[0].params[1] === SHOP, JSON.stringify(priv) + ' ' + JSON.stringify(w));
    ok('the shop\'s default schema follows the same choice (entity_schemas.visibility written for this shop)', schemaWrites().length === 1 && schemaWrites()[0].params[1] === SHOP, JSON.stringify(schemaWrites()));
    const net = await patch({ catalogue_visibility: 'network' });
    ok('owner sets network: the column is written with network', net.status === 200 && visWrites().length === 1 && visWrites()[0].params[0] === 'network', JSON.stringify(net) + JSON.stringify(visWrites()));
    const bad = await patch({ catalogue_visibility: 'everyone' });
    ok('a value outside public|private|network writes nothing to the column', visWrites().length === 0 && schemaWrites().length === 0, JSON.stringify(bad) + JSON.stringify(visWrites()));
    const none = await patch({ display_name: 'Kaveri Mess' });
    ok('a profile save that does not send the key leaves catalogue_visibility alone', none.status === 200 && visWrites().length === 0, JSON.stringify(none));
  } finally { server.close(); }
  done();
})();
