#!/usr/bin/env node
// @type: contract
/**
 * ctr-172-quick-key-items.test.cjs — CTR-172 (BH-17): PATCH /api/quick-keys/groups/:id/items refuses a group that is not there and an items body of the wrong kind, in words.
 *
 * OWNS      the proof that a group id that is not a uuid answers 404 NOT_FOUND before the database, a uuid no group holds answers 404 and writes nothing (it was 200 {"ok":true}), an items
 *           body that is not a list of {product_id: uuid, position: whole number} answers 400 QUICK_KEY_INVALID without the database being asked, a database fault answers 500 INTERNAL
 *           with none of the thrown text, and a real group still reorders (200 {"ok":true}).
 * MIN       the minimum this guard must show: the 404 and 400 answers are problem+json with a registered code, the stand-in db is never asked for a refused request, a valid call is still ok.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/quick-keys.js and lib/quick-keys.js over a stand-in db that speaks Postgres's own words.
 * FLOW      stub db + auth → real router on an express app → request over http → status · code · content type · no leak · queries asked
 * CARD      28-platform-and-operations/quick-keys-routes
 * TRACE     CTR-172 · BH-17 (PM/BUG-HUNT-2026-10-31.md)
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
const GROUP = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const TEA = '33333333-3333-4333-8333-333333333333';
const DRIVER_TEXT = 'invalid input syntax for type uuid: "abc"';
const queries = [];
let fault = null;

/* the stand-in db: like Postgres it refuses a non-uuid id with its own words; only GROUP is a group this shop holds */
const run = async (sql, params) => {
  queries.push(sql);
  if (fault) throw fault;
  if ((params || []).some((p) => typeof p === 'string' && /^[a-z]{3}$/.test(p))) throw Object.assign(new Error(DRIVER_TEXT), { code: '22P02' });
  if (/FROM quick_key_group /.test(sql)) return { rows: params[0] === GROUP ? [{ id: GROUP, version: 1, is_deleted: false }] : [] };
  return { rows: [] };
};
const stubDb = { query: run };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)), pool: {} } };
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity' };
  next();
};
stubAuth.entityOf = (req) => req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
app.use('/api/quick-keys', require(path.join(ROOT, 'routes', 'quick-keys.js')));

let checks = 0;
let failed = 0;
const check = (ok, label) => {
  checks++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, method, url, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body === undefined ? {} : body);
    const req = http.request({ port: server.address().port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
    req.end(data);
  });
const writes = () => queries.filter((sql) => /^\s*(UPDATE|INSERT|DELETE)/i.test(sql));
const items = (id) => '/api/quick-keys/groups/' + id + '/items';

/** every route that names a group answers a non-uuid id as an unknown group, before the database */
async function badIdRoutes(server) {
  const routes = [['PATCH', items('abc')], ['PATCH', '/api/quick-keys/groups/abc'], ['DELETE', '/api/quick-keys/groups/abc'], ['POST', items('abc')], ['DELETE', items('abc') + '/' + TEA], ['DELETE', items(GROUP) + '/abc']];
  for (const [method, url] of routes) {
    queries.length = 0;
    const a = await ask(server, method, url, { items: [], product_id: TEA });
    const label = method + ' ' + url.replace('/api/quick-keys', '');
    check(a.status === 404 && a.body.code === 'NOT_FOUND', label + ' → 404 NOT_FOUND (got ' + a.status + ' ' + a.body.code + ')');
    check(/problem\+json/.test(a.type) && !/invalid input syntax|uuid|22P02/i.test(a.text), label + ' → problem+json, no driver text');
    check(queries.length === 0, label + ' → the database was never asked');
  }
}

/** an items body of the wrong kind is refused in words, and the database is not asked */
async function badBodies(server) {
  const bodies = [
    ['items is text', { items: 'x' }],
    ['items is a number', { items: 5 }],
    ['items is an object', { items: { product_id: TEA } }],
    ['an entry is a number', { items: [1] }],
    ['a product_id that is not a uuid', { items: [{ product_id: 'abc', position: 1 }] }],
    ['a position that is text', { items: [{ product_id: TEA, position: 'zz' }] }],
    ['a position past what a number column holds', { items: [{ product_id: TEA, position: 1e21 }] }],
    ['a position with a fraction', { items: [{ product_id: TEA, position: 1.5 }] }]
  ];
  for (const [what, body] of bodies) {
    queries.length = 0;
    const a = await ask(server, 'PATCH', items(GROUP), body);
    check(a.status === 400 && a.body.code === 'QUICK_KEY_INVALID', what + ' → 400 QUICK_KEY_INVALID (got ' + a.status + ' ' + a.body.code + ')');
    check(/problem\+json/.test(a.type) && !/invalid input syntax|uuid|22P02|unnest|SELECT/i.test(a.text), what + ' → no database text');
    check(queries.length === 0, what + ' → the database was never asked');
  }
}

/** the library alone: reorderItems throws not_found for a group the shop does not hold, before any write, and does not throw for one it holds (the unit of the rule) */
async function libraryRule() {
  const qk = require(path.join(ROOT, 'lib', 'quick-keys.js'));
  queries.length = 0;
  const refused = await qk.reorderItems(stubDb, SHOP, UNKNOWN, [{ product_id: TEA, position: 1 }], null).then(() => null, (e) => e);
  check(!!refused && refused.code === 'not_found', 'reorderItems on a group the shop does not hold throws not_found (the route words it 404)');
  check(writes().length === 0, 'reorderItems throws before any write, so a refused reorder leaves the order as it was (fail closed)');
  const done = await qk.reorderItems(stubDb, SHOP, GROUP, [], null).then((r) => r, () => null);
  check(!!done && done.ok === true, 'reorderItems on a held group answers ok');
}

(async () => {
  const server = app.listen(0);
  await libraryRule();
  await badIdRoutes(server);

  queries.length = 0;
  const unknown = await ask(server, 'PATCH', items(UNKNOWN), {});
  check(unknown.status === 404 && unknown.body.code === 'NOT_FOUND', 'an unknown group uuid → 404 NOT_FOUND (got ' + unknown.status + ')');
  check(writes().length === 0, 'an unknown group → nothing written, not even an audit row');

  await badBodies(server);

  queries.length = 0;
  const good = await ask(server, 'PATCH', items(GROUP), { items: [{ product_id: TEA, position: 2 }] });
  check(good.status === 200 && good.body.ok === true, 'a real group still reorders (200 {ok:true}, got ' + good.status + ')');
  check(writes().filter((sql) => /UPDATE quick_key_group_item/.test(sql)).length === 1, 'the reorder is one statement');
  const empty = await ask(server, 'PATCH', items(GROUP), {});
  check(empty.status === 200 && empty.body.ok === true, 'a real group with no items sent still answers ok, as before (got ' + empty.status + ')');

  fault = Object.assign(new Error('connection to server at "10.0.0.5" refused SELECT secret'), { code: '08006' });
  const down = await ask(server, 'PATCH', items(GROUP), { items: [] });
  check(down.status === 500 && down.body.code === 'INTERNAL' && !/10\.0\.0\.5|SELECT|refused/.test(down.text), 'a database fault → 500 INTERNAL, none of the thrown text (got ' + down.status + ')');

  server.close();
  console.log(checks + ' checks' + (failed ? ' · ' + failed + ' FAILED' : ''));
  process.exitCode = failed ? 1 : 0;
})();
