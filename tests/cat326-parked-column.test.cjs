#!/usr/bin/env node
// @type: unit
/**
 * cat326-parked-column.test.cjs - CAT-326: a column is "in use" while a change that sets a value for it is PARKED for a date, so the delete and retype doors refuse (409,
 * with the count) instead of removing or retyping the column under it. lib/schedule.parkedUsing counts the pending rows (not applied, not cancelled) whose patch holds a
 * non-null value for the key. No database: the real routes/schemas.js and lib/schedule.js over a recording stand-in db.
 * CALLED BY scripts/guards.cjs · CI.    Run: node tests/cat326-parked-column.test.cjs
 * CARD      06-catalogue-pim/schedule-and-availability
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
const SHOP = '11111111-1111-4111-8111-111111111111';
const world = { storedWithValue: 0, parked: 0, deleted: 0, sql: [] };

const run = async (sql) => {
  world.sql.push(sql);
  if (/FROM schema_fields sf/.test(sql)) return { rows: [{ field_id: 'f1', field_name: 'Grade', field_type: 'text', required: false, schema_id: 's1' }] };
  if (/FROM catalogue_item_schedule/.test(sql)) return { rows: [{ n: world.parked }] };
  if (/FROM catalogue_items ci/.test(sql)) return { rows: [{ n: world.storedWithValue }] };
  if (/DELETE FROM schema_fields/.test(sql)) { world.deleted++; return { rows: [], rowCount: 1 }; }
  return { rows: [], rowCount: 0 };
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: run, withEntity: async (id, fn) => fn({ query: run }), pool: {} } };
const schemaPath = require.resolve(path.join(ROOT, 'lib', 'schema'));
require(schemaPath).hasTable = async () => true;
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity' }; next(); };
stubAuth.entityOf = (req) => req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'req-test'; next(); });
app.use('/api/schemas', require(path.join(ROOT, 'routes', 'schemas.js')));

let failed = 0, checks = 0;
const check = (ok, label, why) => { checks++; if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' · ' + JSON.stringify(why).slice(0, 300))); };
const call = (server, method, p, body) => new Promise((resolve) => {
  const data = body ? JSON.stringify(body) : '';
  const req = http.request({ port: server.address().port, method, path: '/api/schemas' + p, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.end(data);
});

(async () => {
  const server = app.listen(0);
  let a = await call(server, 'DELETE', '/fields/grade');
  check(a.status === 200 && world.deleted === 1, 'no stored value, nothing parked -> the column is removed (got ' + a.status + ')', a.text);

  world.parked = 2; world.deleted = 0;
  a = await call(server, 'DELETE', '/fields/grade');
  check(a.status === 409 && world.deleted === 0 && /2 product/.test(a.text), 'CAT-326: nothing stored but 2 changes parked for a date -> 409 with the count, nothing deleted (got ' + a.status + ')', a.text);

  a = await call(server, 'PATCH', '/fields/grade', { field_type: 'number' });
  check(a.status === 409 && !world.sql.some((q) => /UPDATE schema_fields/.test(q)), 'CAT-326: the retype door refuses the same way and writes nothing (got ' + a.status + ')', a.text);

  world.parked = 0;
  a = await call(server, 'PATCH', '/fields/grade', { field_type: 'number' });
  check(a.status === 200 && world.sql.some((q) => /UPDATE schema_fields/.test(q)), 'nothing parked -> the retype goes through (got ' + a.status + ')', a.text);

  const S = require(path.join(ROOT, 'lib', 'schedule'));
  world.sql = []; world.parked = 1;
  const n = await S.parkedUsing(SHOP, 'grade');
  const q = world.sql.find((x) => /catalogue_item_schedule/.test(x)) || '';
  check(n === 1 && /applied_at IS NULL/.test(q) && /cancelled_at IS NULL/.test(q) && /jsonb_typeof\(patch->\$2\) <> 'null'/.test(q), 'parkedUsing counts only pending rows with a non-null value for the key', q);
  server.close();
  say(checks + ' checks, ' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();
