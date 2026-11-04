#!/usr/bin/env node
// @type: contract
/**
 * k1-chits-guard.test.cjs — K-1 (API-10) for routes/chits.js: an id in the address that is not a uuid is answered EXACTLY as a uuid that names nothing (S41), never a 500.
 *
 * OWNS      the proof for the chits router's four guarded params (chit_id · raida_id · subject_id · dispute_id): for every guarded route, a junk id and an unknown uuid give the same
 *           status, code, detail and old body keys; the database is never asked about the junk id; a signed-out caller still gets 401 first.
 *           (tests/k1-path-uuid.test.cjs holds the plain 404 rows of this file too; the 403 and 400 answers cannot sit in that table, which only knows 404.)
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in sign-in and a db that throws Postgres's own words on a junk uuid.
 * FLOW      stub db (every table migrated, no rows) + auth → real router at /api/chits → each route with an unknown uuid, then with "abc" → compare
 * MIN       contract - every row: abc == unknown uuid, 0 queries, problem+json, 401 before 404.
 * CARD      01-rail-core-the-chit/chits-routes
 * ADD A ROW when a chits route gains a guarded id: [method, path with :c (chit) · :r (entry) · :s (register) · :d (dispute), a body its schema accepts]; its words go in routes/chits.js (CHIT_GONE).
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const ROOT = path.join(__dirname, '..');
const ME = '11111111-1111-4111-8111-111111111111';
const GOOD = '33333333-3333-4333-8333-333333333333';
const LINE = '44444444-4444-4444-8444-444444444444';
const queries = [];
const run = async (sql, params) => {
  queries.push(String(sql));
  if (/information_schema/.test(String(sql))) return { rows: [{ '?column?': 1 }], rowCount: 1 }; /* every table and column is there */
  if ((params || []).some((p) => p === 'abc')) throw Object.assign(new Error('invalid input syntax for type uuid: "abc"'), { code: '22P02' });
  return { rows: [], rowCount: 0 };
};
const stubDb = { query: run, connect: async () => ({ query: run, release() {} }) };
const stub = (rel, exports) => {
  const file = require.resolve(path.join(ROOT, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('db', {
  query: run,
  pool: stubDb,
  withEntity: async (id, fn) => fn(stubDb),
  withTransaction: async (fn) => fn(stubDb),
  onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)),
  trySavepoint: async (db, fn, fallback) => {
    try {
      return await fn(db);
    } catch (e) {
      return fallback;
    }
  },
  readBatch: async (id, statements) => (statements || []).map(() => ({ rows: [], rowCount: 0 }))
});
stub(path.join('src', 'db'), { pool: stubDb, withTx: async (fn) => fn(stubDb) });
/* the stand-in sign-in: a request without an Authorization header is refused 401, as the real one does */
const stubAuth = (req, res, next) => {
  if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorised', code: 'TOKEN_MISSING' });
  req.identity = { identity_id: ME, identity_type: 'entity', display_name: 'Me' };
  next();
};
stubAuth.entityOf = (req) => req.identity.identity_id;
stub(path.join('middleware', 'auth'), stubAuth);

/** [method, path (:c chit · :r entry · :s register · :d dispute), a body the route's schema accepts so only the id is wrong] — every route the junk-id guard answers */
const ROUTES = [
  ['GET', ':c'], ['GET', ':c/use'], ['GET', ':c/messages'], ['GET', ':c/disputes'], ['GET', ':c/diagnosis'],
  ['PUT', ':c/use', {}], ['PUT', ':c/status', { status: 'accepted' }], ['PUT', ':c/void', { reason: 'wrong chit' }], ['PUT', ':c/priority', { priority: 'high' }],
  ['PUT', ':c/priority-flag', { priority: true }], ['PUT', ':c/star', {}], ['PUT', ':c/disputes/:d/resolve', { resolution_note: 'done' }],
  ['POST', ':c/amend', { edits: [{ line_id: LINE, quantity: 1 }] }], ['POST', ':c/reprice', {}], ['POST', ':c/assign-lines', { edits: [{ line_id: LINE, assignee_id: LINE }] }],
  ['POST', ':c/deliver-lines', { rows: [{ line_id: LINE, quantity: 1 }] }], ['POST', ':c/costs', { rows: [{ kind: 'fuel', amount: 5 }] }],
  ['POST', ':c/books-request', {}], ['POST', ':c/messages', { message_text: 'hello', thread_type: 'external' }],
  ['POST', ':c/disputes', { category: 'quality', reason: 'The goods were short by two boxes' }], ['POST', ':c/raida', { kind: 'risk', body: 'a risk' }],
  ['POST', ':c/archive', {}], ['POST', ':c/unarchive', {}], ['POST', ':c/restore', {}], ['POST', ':c/unread', {}],
  ['DELETE', ':c', {}], ['DELETE', ':c/payment', {}], ['DELETE', ':c/purge', {}],
  ['POST', 'register/entries/:r/accept', { accepted_by_name: 'Me' }], ['POST', 'register/entries/:r/close', { body: 'done', disposition: 'resolved' }],
  ['POST', 'register/entries/:r/revise', { body: 'reworded' }], ['POST', ':c/raida/:r/close', { body: 'done', disposition: 'resolved' }],
  ['POST', ':c/raida/:r/dispute', { dispute_id: LINE }], ['POST', 'register/subjects/:s/close', {}]
];

/** routes answered in their handlers, not by the guard: an unknown uuid is a 200 empty list or a 400 of lib/raida's, and a junk id must give exactly that (S41) */
const SAME = [
  ['GET', ':c/costs'],
  ['GET', ':c/raida'],
  ['GET', ':c/raida?line_id=' + LINE],
  ['POST', 'register/subjects/:s/entries', { kind: 'risk', body: 'a risk' }]
];

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
app.use('/api/chits', require(path.join(ROOT, 'routes', 'chits.js')));

let checks = 0;
let failed = 0;
const check = (ok, label) => {
  checks++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, method, url, body, signedIn = true) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
    if (signedIn) headers.authorization = 'Bearer test';
    const req = http.request({ port: server.address().port, method, path: url, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          type: res.headers['content-type'] || '',
          text,
          body: (() => {
            try {
              return JSON.parse(text);
            } catch (e) {
              return {};
            }
          })()
        })
      );
    });
    req.end(data);
  });
const PROBLEM_KEYS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];
const oldKeys = (b) => JSON.stringify(Object.keys(b).filter((k) => !PROBLEM_KEYS.includes(k)));
const fill = (template, id) => '/api/chits/' + template.replace(':c', id).replace(':r', id).replace(':s', id).replace(':d', id);

(async () => {
  const server = app.listen(0);
  for (const [method, template, body] of ROUTES) {
    const label = method + ' ' + template;
    const unknown = await ask(server, method, fill(template, GOOD), body);
    queries.length = 0;
    const junk = await ask(server, method, fill(template, 'abc'), body);
    const asked = queries.length;
    check(junk.status === unknown.status && junk.status < 500, label + " → the unknown uuid's status (" + unknown.status + '), got ' + junk.status);
    check(junk.body.code === unknown.body.code && junk.body.detail === unknown.body.detail, label + ' → its code and detail (' + unknown.body.code + ')');
    check(
      oldKeys(junk.body) === oldKeys(unknown.body) && junk.body.error === unknown.body.error && junk.body.message === unknown.body.message && junk.body.why === unknown.body.why,
      label + ' → its old body keys'
    );
    check(/problem\+json/.test(junk.type) && !/invalid input syntax|22P02/i.test(junk.text), label + ' → problem+json, no driver text');
    check(asked === 0, label + ' → the database was never asked (' + asked + ')');
    const signedOut = await ask(server, method, fill(template, 'abc'), body, false);
    check(signedOut.status === 401, label + ' → signed out: 401 before the junk id is judged (got ' + signedOut.status + ')');
  }
  const sameBody = (a) => JSON.stringify([a.status, a.type, a.text.replace(/"request_id":"[^"]*"/, '')]);
  for (const [method, template, body] of SAME) {
    const label = method + ' ' + template + ' (answered by the handler)';
    const unknown = await ask(server, method, fill(template, GOOD), body);
    const junk = await ask(server, method, fill(template, 'abc'), body);
    check(junk.status < 500 && !/invalid input syntax|22P02/i.test(junk.text), label + ' → no 5xx, no driver text (got ' + junk.status + ')');
    check(sameBody(junk) === sameBody(unknown), label + ' → answered exactly as an unknown uuid (' + unknown.status + ')');
  }
  server.close();
  console.log('\n' + checks + ' checks');
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
