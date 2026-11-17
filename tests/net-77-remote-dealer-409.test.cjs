#!/usr/bin/env node
// @type: unit
/**
 * net-77-remote-dealer-409.test.cjs — NET-77 (owner cb-network): asking to connect to a business on ANOTHER installation (a supplier stub here) is refused, nothing saved.
 *
 * RULE      POST /api/network/connections naming a remote business ({childHandle: its bridge id}, a stub made by a supplier add) answers 409 NETWORK_REMOTE_NOT_YET in words,
 *           and writes NO edge: before the fix it answered 200 and kept a `requested` edge on this server only (the far server answers EDGE_NOT_FOUND; RAIL-112 pattern).
 *           A local business is still asked as before. NET-79 is the real fix (the ask crosses as a CTP event); until then this refusal stands.
 * HAND-COMPUTED  world: A signs in, C is a stub on installation sit-in. ask {childHandle: 'CCCC4444'} as A → status 409, code NETWORK_REMOTE_NOT_YET, problem body (RFC 9457),
 *           edges after = 0 rows. Control: same ask with C local → 200 state requested, edges after = 1 row.
 * RUN       node tests/net-77-remote-dealer-409.test.cjs   (NET77_SERVICE=<file> points it at the mutation check's broken copy)
 * CARD      04-network/connections-and-invitations
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });

const ROOT = path.join(__dirname, '..');
const { memory, A, C } = require('./lib/network-memory.cjs');
let world;
let remote = new Set();
let unresolved = new Set();
const keyReads = []; // the bridge-key arrays refuseRemoteNodes sent to the database
const run = async (sql, params) => { if (/bridge_key/.test(sql)) keyReads.push(params[0]);
  const a = world.answer(sql, params); if (process.env.NET77_TRACE) process.stderr.write(String(sql).replace(/\s+/g, ' ').slice(0, 100) + ' => ' + (a ? a.rows.length : 'NULL') + '\n'); return a || { rows: [], rowCount: 0 }; };
const stub = (file, exports) => { const id = require.resolve(path.join(ROOT, file)); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const dbExports = { query: run, pool: { query: run }, withTx: async (fn) => fn({ query: run }), withEntity: async (id, fn) => fn({ query: run }), withTransaction: async (fn) => fn({ query: run }) };
stub('db', dbExports);
stub('src/db', dbExports); // src/services/network.js reads src/db.js
/* the real ctpaddress (its parse is the route's bridge-id guard); only the topology read is stood in for: which businesses are hosted elsewhere */
stub('lib/ctpaddress', { ...require(path.join(ROOT, 'lib', 'ctpaddress')), resolve: async (entity_id) => (unresolved.has(entity_id) ? { entity_id, local: true, resolved: false } : remote.has(entity_id) ? { entity_id, local: false, installation_key: 'sit-in' } : { entity_id, local: true }) });
const authId = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const authStub = (req, res, next) => { req.identity = { identity_id: A, identity_type: 'entity' }; req.entityId = A; next(); };
authStub.entityOf = () => A;
authStub.requireRole = () => (req, res, next) => next();
authStub.requireIdentity = authStub;
require.cache[authId] = { id: authId, filename: authId, loaded: true, exports: authStub };
if (process.env.NET77_SERVICE) {
  const real = require.resolve(path.join(ROOT, 'src', 'services', 'network.js'));
  require.cache[real] = { id: real, filename: real, loaded: true, exports: require(path.join(ROOT, process.env.NET77_SERVICE)) }; // the mutation check points this at a broken copy
}

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' :: ' + detail)); };

function ask(server, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ port: server.address().port, path: '/api/network/connections', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/network', require(path.join(ROOT, 'src', 'routes', 'network.js')));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    world = memory({ childClaimed: false });
    remote = new Set([C]);
    const refused = await ask(server, { childHandle: 'CCCC4444', type: 'commercial' });
    const text = JSON.stringify(refused.body);
    check('remote stub, asked by its bridge id: 409', refused.status === 409, refused.status + ' ' + text);
    check('the registered code NETWORK_REMOTE_NOT_YET, in the one problem shape', refused.body.code === 'NETWORK_REMOTE_NOT_YET' && !!refused.body.title && refused.body.status === 409, text);
    check('words a shopkeeper reads, and says nothing was saved', /another ChitBridge installation/.test(text) && /Nothing was saved/.test(text), text);
    check('NOTHING saved on the hub: no edge row', world.data.edges.length === 0, JSON.stringify(world.data.edges));

    world = memory({ childClaimed: false });
    remote = new Set();
    const local = await ask(server, { childHandle: 'CCCC4444', type: 'commercial' });
    check('control, the same business but local: still asked (200, requested)', local.status === 200 && world.data.edges.length === 1 && world.data.edges[0].state === 'requested', local.status + ' ' + JSON.stringify(world.data.edges));

    /* a refused ask writes NOTHING: no edge and no cb_entity stub (C has an identity but no node; asking by handle used to make one before refusing) */
    world = memory({ bare: true });
    remote = new Set([C]);
    const bare = await ask(server, { childHandle: 'shop-a.c', type: 'commercial' });
    check('refused by handle, C without a node: 409', bare.status === 409 && bare.body.code === 'NETWORK_REMOTE_NOT_YET', bare.status + ' ' + JSON.stringify(bare.body));
    check('zero cb_entity rows written by the refused ask', world.data.entityInserts === 0 && world.data.entities.length === 2, world.data.entityInserts + ' inserts, ' + world.data.entities.length + ' nodes');
    check('zero edges after the refused ask', world.data.edges.length === 0, JSON.stringify(world.data.edges));

    /* {local:true, resolved:false}: where it lives could not be read, so it may be remote: refused like lib/mint.refuseUnresolved */
    world = memory({ childClaimed: false });
    remote = new Set();
    unresolved = new Set([C]);
    const unread = await ask(server, { childHandle: 'CCCC4444', type: 'commercial' });
    check('unresolved installation: 409, no edge', unread.status === 409 && unread.body.code === 'NETWORK_REMOTE_NOT_YET' && world.data.edges.length === 0, unread.status + ' ' + JSON.stringify(unread.body));
    unresolved = new Set();

    /* no identity row behind the node: fail closed */
    world = memory({ childClaimed: false });
    world.data.identities = world.data.identities.filter((one) => one.identity_id !== C);
    const nobody = await ask(server, { childBridgeId: 'CCCC4444', type: 'commercial' });
    check('a node with no identity row is refused (fail closed), no edge', nobody.status === 409 && nobody.body.code === 'NETWORK_REMOTE_NOT_YET' && world.data.edges.length === 0, nobody.status + ' ' + JSON.stringify(nobody.body));

    /* a node with NO bridge id: its key is null (dropped), never the text 'UNDEFINED'; it matches nothing, so it is refused (fail closed) */
    keyReads.length = 0;
    const svc = process.env.NET77_SERVICE ? require(path.join(ROOT, process.env.NET77_SERVICE)) : require(path.join(ROOT, 'src', 'services', 'network.js'));
    const rejected = await svc.refuseRemoteNodes([{ bridge_id: null }, { bridge_id: undefined }, { bridge_id: '' }]).then(() => null, (e) => e);
    check('a node with no bridge id is refused (fail closed, 409)', !!rejected && rejected.status === 409, String(rejected && (rejected.status || rejected.message)));
    check('and the text UNDEFINED is never sent as a key (null keys are dropped)', keyReads.length > 0 && keyReads.every((keys) => keys.length === 0), JSON.stringify(keyReads));
  } finally {
    server.close();
  }
  say(failed ? failed + ' FAILED' : 'all ok');
  process.exit(failed ? 1 : 0);
})().catch((e) => { say('FAIL crashed :: ' + (e && e.stack || e)); process.exit(1); });
