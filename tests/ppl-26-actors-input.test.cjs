#!/usr/bin/env node
// @type: contract
/**
 * ppl-26-actors-input.test.cjs — PPL-26 (BH-12): the shop's people settings and person edits refuse a wrongly typed value in words, never as a driver 500.
 *
 * OWNS      the proof that PUT /api/actors/settings, PATCH /api/actors/:id, POST /check-key, POST /suggest-key and PUT /:id/delegate answer 400 problem+json (code INVALID_INPUT, the field named)
 *           when a field holds a list or an object where a word, number or flag belongs, that an id in the address that is not a uuid answers 404 NOT_FOUND, that the database is never asked
 *           and nothing is written in either case, that none of Postgres's own words reach the answer, and that a valid call still succeeds.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/actors.js over a stand-in sign-in and a db that throws Postgres's own words.
 * FLOW      stub db + auth → real router on an express app → request over http → status · code · content type · queries asked · no leak
 * CARD      17-people-employees-hr-and-payroll/functions
 * MIN       the 5 routes of BH-12, each with its wrong-typed inputs, plus the valid calls
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

/* a wrong value for every field BH-12 names, as the list the bug hunt used and an object */
const SETTINGS = ['assignment_model', 'default_max_tasks', 'all_task_visible', 'auto_return_on_short_break', 'auto_assign_mode', 'default_assignee_actor_id'];
const PERSON_FIELDS = ['display_name', 'actor_role', 'phone', 'max_tasks', 'email'];
const WRONG = [[], { a: 1 }];

async function refused(server, method, url, body, label, field) {
  queries.length = 0;
  const a = await ask(server, method, url, body);
  check(a.status === 400, label + ' → 400 (got ' + a.status + ')');
  check(a.body.code === 'INVALID_INPUT' && /problem\+json/.test(a.type), label + ' → problem+json INVALID_INPUT (got ' + a.body.code + ')');
  check(!field || a.body.field === field, label + ' → names ' + field + ' (got ' + a.body.field + ')');
  check(!DRIVER.test(a.text), label + ' → no driver or runtime text');
  check(queries.length === 0, label + ' → the database was never asked and nothing written (' + queries.length + ' queries)');
}

(async () => {
  const server = app.listen(0);
  for (const field of SETTINGS) for (const wrong of WRONG) await refused(server, 'PUT', '/api/actors/settings', { [field]: wrong }, 'PUT /settings ' + field + '=' + JSON.stringify(wrong), field);
  for (const field of PERSON_FIELDS) for (const wrong of WRONG) await refused(server, 'PATCH', '/api/actors/' + PERSON, { [field]: wrong }, 'PATCH /:id ' + field + '=' + JSON.stringify(wrong), field);
  for (const wrong of WRONG) {
    await refused(server, 'POST', '/api/actors/check-key', { actor_key: wrong }, 'POST /check-key actor_key=' + JSON.stringify(wrong), 'actor_key');
    await refused(server, 'POST', '/api/actors/suggest-key', { display_name: wrong }, 'POST /suggest-key display_name=' + JSON.stringify(wrong), 'display_name');
    await refused(server, 'PUT', '/api/actors/' + PERSON + '/delegate', { delegate_actor_id: wrong }, 'PUT /:id/delegate delegate_actor_id=' + JSON.stringify(wrong), 'delegate_actor_id');
  }
  /* an id in the address that is not a uuid names nobody: 404 in words, before the database */
  for (const [method, url, body] of [['PATCH', '/api/actors/abc', { display_name: 'Ravi' }], ['PUT', '/api/actors/abc/delegate', { delegate_actor_id: null }]]) {
    queries.length = 0;
    const a = await ask(server, method, url, body);
    check(a.status === 404 && a.body.code === 'NOT_FOUND' && /problem\+json/.test(a.type), method + ' ' + url + ' → 404 NOT_FOUND problem+json (got ' + a.status + ' ' + a.body.code + ')');
    check(!DRIVER.test(a.text) && queries.length === 0, method + ' ' + url + ' → no driver text, the database never asked (' + queries.length + ' queries)');
  }
  /* what is valid still works */
  const okSettings = await ask(server, 'PUT', '/api/actors/settings', { assignment_model: 'push', default_max_tasks: 12, all_task_visible: true, auto_return_on_short_break: false, auto_assign_mode: 'least_loaded' });
  check(okSettings.status === 200, 'PUT /settings with valid values → 200 (got ' + okSettings.status + ')');
  const okPatch = await ask(server, 'PATCH', '/api/actors/' + PERSON, { display_name: 'Ravi Kumar', phone: '+919800000000', max_tasks: 5, actor_role: null });
  check(okPatch.status === 200, 'PATCH /:id with valid values → 200 (got ' + okPatch.status + ' ' + okPatch.text.slice(0, 80) + ')');
  const okKey = await ask(server, 'POST', '/api/actors/check-key', { actor_key: 'ravik' });
  check(okKey.status === 200, 'POST /check-key with a valid key → 200 (got ' + okKey.status + ')');
  const okSuggest = await ask(server, 'POST', '/api/actors/suggest-key', { display_name: 'Ravi Kumar' });
  check(okSuggest.status === 200, 'POST /suggest-key with a name → 200 (got ' + okSuggest.status + ')');
  const okDelegate = await ask(server, 'PUT', '/api/actors/' + PERSON + '/delegate', { delegate_actor_id: null });
  check(okDelegate.status === 200, 'PUT /:id/delegate clearing the delegate → 200 (got ' + okDelegate.status + ')');
  server.close();
  console.log(checks + ' checks' + (failed ? ', ' + failed + ' FAILED' : ', all passed'));
  process.exit(failed ? 1 : 0);
})();
