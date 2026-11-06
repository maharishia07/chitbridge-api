#!/usr/bin/env node
// @type: unit
/**
 * change-pin-lock.test.cjs — PPL-30 (owner cb-people): change-pin counts and locks like sign-in. In scripts/guards.cjs.
 *
 * RULE      PUT /api/actors/change-pin checks the current PIN through identityAuth.verifyCredential (the sign-in door's engine): a wrong PIN is counted (pin_attempts)
 *           and locks at MAX_PIN_ATTEMPTS (5, ASVS V2.2.1), a locked person is refused PIN_LOCKED and nothing is written, a right PIN resets the count.
 * RUN       node tests/change-pin-lock.test.cjs
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
const pinCount = require('./lib/pin-count-stub.cjs');
const AUTH_PATH = require.resolve(path.join(ROOT, 'lib', 'identity-auth'));
// CHANGE_PIN_AUTH: the mutation check swaps in an engine that counts by read-then-write
if (process.env.CHANGE_PIN_AUTH) require.cache[AUTH_PATH] = { id: AUTH_PATH, filename: AUTH_PATH, loaded: true, exports: require(path.join(ROOT, process.env.CHANGE_PIN_AUTH)) };
const identityAuth = require(path.join(ROOT, 'lib', 'identity-auth'));
const queries = [];
let row;
const READ_THEN_WRITE = /^UPDATE identities SET pin_attempts = \$2(, pin_locked_at = NOW\(\))? WHERE identity_id = \$1$/;

const stubDb = async (sql, args) => {
  const s = String(sql).replace(/\s+/g, ' ');
  queries.push(s);
  await new Promise(setImmediate); // a real round trip: other requests run between two statements
  const counted = pinCount.answer(s, args, () => row);
  if (counted) return counted;
  if (READ_THEN_WRITE.test(s)) { row.pin_attempts = args[1]; if (/pin_locked_at/.test(s)) row.pin_locked_at = new Date(); return { rows: [], rowCount: 1 }; } // the old statement, for the mutation
  if (/^SELECT .*FROM identities WHERE identity_id = \$1$/.test(s) && /pin_locked_at/.test(s)) return { rows: [{ ...row }] };
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
app.use('/api/actors', require(path.join(ROOT, process.env.CHANGE_PIN_ROUTE || 'routes/actors.js'))); // CHANGE_PIN_ROUTE: the mutation check points this at a broken copy

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

const wrote = (re) => queries.some((q) => re.test(q));
const PIN_WRITE = /SET pin_hash = \$1/;
const send = (body) => (queries.length = 0, change(server, body));
let server;

(async () => {
  server = app.listen(0);
  const good = { current_pin: '1234', new_pin: '5555', confirm_pin: '5555' };
  const hash = await identityAuth.hashPin('1234');

  row = { pin_hash: hash, pin_attempts: 0, pin_locked_at: null };
  let a = await send({ ...good, current_pin: "9999" });
  check(a.status === 400 && /PIN_INCORRECT/.test(a.text), 'a wrong current PIN is refused 400 PIN_INCORRECT');
  check(row.pin_attempts === 1 && wrote(/SET pin_attempts = pin_attempts \+ 1/) && !wrote(PIN_WRITE), 'a wrong current PIN is COUNTED (UPDATE pin_attempts), no PIN written');

  row = { pin_hash: hash, pin_attempts: identityAuth.MAX_PIN_ATTEMPTS - 1, pin_locked_at: null };
  a = await send({ ...good, current_pin: '9999' });
  check(a.status === 400 && /PIN_LOCKED/.test(a.text) && !!row.pin_locked_at, 'the miss at the sign-in threshold (' + identityAuth.MAX_PIN_ATTEMPTS + ') LOCKS and says so in words');

  row = { pin_hash: hash, pin_attempts: 5, pin_locked_at: new Date().toISOString() };
  a = await send(good);
  check(a.status === 400 && /PIN_LOCKED/.test(a.text) && !wrote(PIN_WRITE), 'a LOCKED person cannot change the PIN even with the right current PIN (PIN_LOCKED, nothing written)');

  row = { pin_hash: hash, pin_attempts: 3, pin_locked_at: null };
  a = await send(good);
  check(a.status === 200 && wrote(PIN_WRITE) && wrote(/pin_attempts = 0/), 'the right current PIN changes it and resets the count');
  row = { pin_hash: hash, pin_attempts: 0, pin_locked_at: null };
  const max = identityAuth.MAX_PIN_ATTEMPTS;
  const burst = await Promise.all(Array.from({ length: 12 }, () => change(server, { ...good, current_pin: '9999' })));
  check(row.pin_attempts === max && !!row.pin_locked_at, '12 PARALLEL wrong PINs count at most ' + max + ' then lock (counted ' + row.pin_attempts + ', locked ' + !!row.pin_locked_at + ')');
  check(burst.every((r) => r.status === 400) && burst.filter((r) => /PIN_INCORRECT/.test(r.text)).length === max - 1, 'in the burst ' + (max - 1) + ' are told "incorrect"; the 5th and the rest are told the PIN is locked');
  server.close();
  say(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
