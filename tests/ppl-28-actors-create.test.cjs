#!/usr/bin/env node
// @type: contract
/**
 * ppl-28-actors-create.test.cjs — PPL-28 (the PPL-26 follow-up): POST /api/actors (add a person) refuses a wrongly typed field in words, never as a 500 or a saved "[object Object]".
 *
 * OWNS      the proof that POST /api/actors answers 400 problem+json (code INVALID_INPUT, the field named) when a field holds a list or an object, or a string where a number or a flag belongs,
 *           with no write to the database, and that a valid add still succeeds.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/actors.js over a stand-in sign-in and a db that throws Postgres's own words.
 * FLOW      stub db + auth → real router on an express app → request over http → status · code · content type · queries asked · no leak
 * CARD      17-people-employees-hr-and-payroll/functions
 * MIN       the 9 body fields of the create, each with its wrong-typed inputs, plus the valid add
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
const PERSON = '33333333-3333-4333-8333-333333333333';
const DRIVER = /invalid input syntax|malformed array|22P02|operator does not exist|is not a function|TypeError|\.trim/i;
const queries = [];
const writes = () => queries.filter((q) => /^s*(INSERT|UPDATE|DELETE)/i.test(q)).length;

/* the stand-in db: like Postgres it refuses a list or object parameter and a non-uuid id with its own words, and answers rows for what is valid */
const refuseLikePostgres = (params) => {
  const odd = (params || []).find((p) => (p !== null && typeof p === 'object' && !(p instanceof Date)) || p === 'abc');
  if (odd !== undefined) throw Object.assign(new Error(odd === 'abc' ? 'invalid input syntax for type uuid: "abc"' : 'malformed array literal: "' + JSON.stringify(odd) + '"'), { code: '22P02' });
};
const stubDb = async (sql, params) => {
  queries.push(sql);
  refuseLikePostgres(params);
  if (/entity_actor_settings/.test(sql)) return { rows: [{ setting_id: 1, entity_id: SHOP, assignment_model: 'both', default_max_tasks: 10 }] };
  if (/UPDATE identities/.test(sql)) return { rows: [{ identity_id: PERSON, display_name: 'Ravi', delegate_actor_id: null }] };
  if (/actor_key = [$]1/.test(sql)) return { rows: [] };
  if (/FROM identities/.test(sql)) return { rows: [{ identity_id: PERSON }] };
  return { rows: [] };
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: stubDb, withEntity: async (id, fn) => fn({ query: stubDb }), onEntity: async (id, db, fn) => (typeof db === 'function' ? db({ query: stubDb }) : fn({ query: stubDb })), withTransaction: async (fn) => fn({ query: stubDb }), pool: {} }
};
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
app.use('/api/actors', require(path.join(ROOT, 'routes', 'actors.js')));

let failed = 0;
let checks = 0;
const check = (ok, label) => {
  checks++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, method, url, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ port: server.address().port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
    req.end(data);
  });

/* a wrong value for every field of the create: a list and an object for each, and a string where a number or a flag belongs */
const VALID = { display_name: 'Ravi Kumar', actor_key: 'ravik', actor_role: 'Cashier', phone: '+919800000000', email: 'ravi@example.com', max_tasks: 5, hat: 'act', access_level: 'editor', whole_entity: false };
const FIELDS = Object.keys(VALID);
const WRONG = [[], { a: 1 }];
const WRONG_KIND = [['max_tasks', '5'], ['whole_entity', 'true'], ['max_tasks', 5.5], ['whole_entity', 1]];

async function refused(server, body, label, field) {
  queries.length = 0;
  const a = await ask(server, 'POST', '/api/actors', body);
  check(a.status === 400, label + ' → 400 (got ' + a.status + ')');
  check(a.body.code === 'INVALID_INPUT' && /problem[+]json/.test(a.type), label + ' → problem+json INVALID_INPUT (got ' + a.body.code + ')');
  check(a.body.field === field, label + ' → names ' + field + ' (got ' + a.body.field + ')');
  check(!DRIVER.test(a.text) && !/object Object/.test(a.text), label + ' → no driver or runtime text');
  check(writes() === 0, label + ' → 0 database writes (' + writes() + ')');
}

(async () => {
  const server = app.listen(0);
  for (const field of FIELDS) for (const wrong of WRONG) await refused(server, { ...VALID, [field]: wrong }, 'POST / ' + field + '=' + JSON.stringify(wrong), field);
  for (const [field, wrong] of WRONG_KIND) await refused(server, { ...VALID, [field]: wrong }, 'POST / ' + field + '=' + JSON.stringify(wrong), field);
  queries.length = 0;
  const ok = await ask(server, 'POST', '/api/actors', VALID);
  check(ok.status === 200 || ok.status === 201, 'POST / with valid values → 200/201 (got ' + ok.status + ' ' + ok.text.slice(0, 120) + ')');
  check(writes() >= 1 && ok.body.actor && ok.body.actor.actor_key === 'ravik', 'POST / with valid values → the person is written and named');
  queries.length = 0;
  const min = await ask(server, 'POST', '/api/actors', { display_name: 'Ravi Kumar', actor_key: 'ravik' });
  check(min.status === 200 || min.status === 201, 'POST / with only the name and key → 200/201 (got ' + min.status + ')');
  server.close();
  console.log(checks + ' checks' + (failed ? ', ' + failed + ' FAILED' : ', all passed'));
  process.exit(failed ? 1 : 0);
})();
