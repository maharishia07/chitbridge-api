#!/usr/bin/env node
// @type: contract
/**
 * ppl-21-login-format.test.cjs — PPL-21: the login a co-assist types (login_format) is built from the shop's User ID, not from its name.
 *
 * OWNS      the proof that POST /api/actors/suggest-key answers `<key>@<user_id>` when identities.user_id is on file (loginIdFor read the id with the db, not with express-validator's query), and the slug of the name only when none is.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/actors.js over a stand-in db and sign-in.
 * FLOW      stub db (user_id row or none) + auth → real router → POST suggest-key → login_format
 * CARD      17-people-employees-hr-and-payroll/functions
 * MIN       one shop with a User ID, one without
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
let userId = 'cholaauto';
const stubDb = async (sql) => {
  if (/SELECT user_id FROM identities/.test(sql)) return { rows: userId ? [{ user_id: userId }] : [{ user_id: null }] };
  return { rows: [] };
};
const stub = (rel, exports) => {
  const file = require.resolve(path.join(ROOT, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('db', { query: stubDb, withEntity: async (id, fn) => fn({ query: stubDb }), withTransaction: async (fn) => fn({ query: stubDb }), pool: {} });
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' };
  next();
};
stubAuth.entityOf = (req) => req.identity.identity_id;
stub(path.join('middleware', 'auth'), stubAuth);

const app = express();
app.use(express.json());
app.use((req, res, next) => ((req.id = 'req-test'), next()));
app.use('/api/actors', require(path.join(ROOT, 'routes', 'actors.js')));

let failed = 0,
  total = 0;
const check = (ok, label) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const suggest = (server) =>
  new Promise((resolve) => {
    const data = JSON.stringify({ display_name: 'Kavya Rao' });
    const req = http.request({ port: server.address().port, method: 'POST', path: '/api/actors/suggest-key', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve(JSON.parse(text)));
    });
    req.end(data);
  });

(async () => {
  const server = app.listen(0);
  const withId = await suggest(server);
  check(/@cholaauto$/.test(withId.login_format), 'login_format ends with the shop User ID (got ' + withId.login_format + ')');
  userId = null;
  const without = await suggest(server);
  check(/@chola-?auto-?care$|@cholaautocare$/.test(without.login_format), 'no User ID on file: the slug of the name, no spaces (got ' + without.login_format + ')');
  server.close();
  console.log(failed ? failed + ' FAILED' : 'all passed (' + total + ' checks)');
  process.exit(failed ? 1 : 0);
})();
