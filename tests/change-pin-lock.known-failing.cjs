#!/usr/bin/env node
// @type: unit
/**
 * change-pin-lock.known-failing.cjs — KNOWN-FAILING (QA no-proof wave 1, 6 Nov 2026; backlog PPL-30, owner cb-people). NOT in scripts/guards.cjs.
 *
 * FINDING   PUT /api/actors/change-pin (routes/actors.js, "Actor changes own PIN from profile page") checks the current PIN with identityAuth.pinMatches and, when it is
 *           wrong, answers 400 and writes NOTHING: no pin_attempts count, no lock, and a person whose PIN is already locked (pin_locked_at) is not turned away either.
 *           The sign-in door counts every wrong PIN and locks (lib/identity-auth.js verifyCredential); this door is a second PIN check with no count, so a signed-in session
 *           (a borrowed phone) can guess the 4-digit PIN without limit. Expected: the same count and lock as sign-in.
 * PROVES    when fixed, both checks below go green: (1) a wrong current PIN is counted (an UPDATE of pin_attempts), (2) a locked person's change is refused and no PIN is written.
 * RUN       node tests/change-pin-lock.known-failing.cjs  (exits 1 while the bug stands; rename to *.test.cjs and enrol in scripts/guards.cjs when the owner fixes it)
 * CARD      17-people-employees-hr-and-payroll/pin-otp-first-sign-in
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
const PERSON = '33333333-3333-4333-8333-333333333333';
const SHOP = '11111111-1111-4111-8111-111111111111';
const identityAuth = require(path.join(ROOT, 'lib', 'identity-auth'));
const queries = [];
let row;

const stubDb = async (sql, args) => {
  const s = String(sql).replace(/\s+/g, ' ');
  queries.push(s);
  if (/SELECT pin_hash, pin_locked_at FROM identities/.test(s)) return { rows: [row] };
  return { rows: [], rowCount: 0 };
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { query: stubDb, withEntity: async (id, fn) => fn({ query: stubDb }), onEntity: async (id, db, fn) => (typeof db === 'function' ? db({ query: stubDb }) : fn({ query: stubDb })), withTransaction: async (fn) => fn({ query: stubDb }), pool: {} }
};
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = { identity_id: PERSON, identity_type: 'actor', parent_entity_id: SHOP }; next(); };
stubAuth.entityOf = (req) => req.identity.parent_entity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'req-test'; next(); });
app.use('/api/actors', require(path.join(ROOT, 'routes', 'actors.js')));

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label); };
const change = (server, body) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const req = http.request({ port: server.address().port, method: 'PUT', path: '/api/actors/change-pin', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.end(data);
});

(async () => {
  const server = app.listen(0);
  row = { pin_hash: await identityAuth.hashPin('1234'), pin_locked_at: null };
  let a = await change(server, { current_pin: '9999', new_pin: '5555', confirm_pin: '5555' });
  check(a.status === 400, 'a wrong current PIN is refused 400 (works today)');
  check(queries.some((q) => /UPDATE identities SET pin_attempts/.test(q)), 'a wrong current PIN is COUNTED (UPDATE pin_attempts) like a wrong PIN at sign-in');

  queries.length = 0;
  row = { pin_hash: await identityAuth.hashPin('1234'), pin_locked_at: new Date().toISOString() };
  a = await change(server, { current_pin: '1234', new_pin: '5555', confirm_pin: '5555' });
  check(a.status >= 400 && !queries.some((q) => /SET pin_hash = \$1/.test(q)), 'a person whose PIN is LOCKED cannot change it by guessing the current one (got ' + a.status + ', PIN written: ' + queries.some((q) => /SET pin_hash = \$1/.test(q)) + ')');
  server.close();
  say(failed ? failed + ' FAILED (known: PPL-30)' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
