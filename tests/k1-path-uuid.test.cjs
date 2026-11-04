#!/usr/bin/env node
// @type: contract
/**
 * k1-path-uuid.test.cjs — K-1 (API-10, BUG-HUNT-2026-10-31 appendix B): a write route whose address carries an id that is not a uuid answers
 * 404 NOT_FOUND as problem+json, never a 500 with the database's words, and the database is never asked.
 *
 * OWNS      the proof for every route closed through lib/problem.js uuidParam (the ONE guard) and its text twin textParam, one row per route in ROUTES; a valid uuid still
 *           passes the guard (next() is called); a route file's own not-found words ride along as its frozen legacy body.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over a stand-in sign-in and a db that throws Postgres's own words.
 * FLOW      stub db + auth → each real router mounted at its prefix → request with id "abc" → status · code · content type · no driver text · no query
 * MIN       contract - every row 404 NOT_FOUND problem+json, 0 queries; uuidParam lets a uuid through.
 * CARD      28-platform-and-operations/api-standard
 * ADD A ROW when a route file adopts uuidParam: [mount, router file, method, path with "abc" in the guarded place, a body its schema accepts, legacy `error`].
 *           The body must pass the route's own schema check, or the row proves the schema refusal (400) and not the guard: run it red on main first.
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
const DRIVER_TEXT = 'invalid input syntax for type uuid: "abc"';
const queries = [];

/* the stand-in db: like Postgres, a non-uuid value where a uuid goes gets the driver's words; nothing is ever found */
const run = async (sql, params) => {
  queries.push(sql);
  if ((params || []).some((p) => p === 'abc')) throw Object.assign(new Error(DRIVER_TEXT), { code: '22P02' });
  return { rows: [], rowCount: 0 };
};
const stubDb = { query: run, connect: async () => ({ query: run, release() {} }) };
const stub = (rel, exports) => {
  const file = require.resolve(path.join(ROOT, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('db', { query: run, pool: stubDb, withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)) });
stub(path.join('src', 'db'), { pool: stubDb, withTx: async (fn) => fn(stubDb) });
const stubAuth = (req, res, next) => {
  req.identity = { identity_id: ME, identity_type: 'entity' };
  next();
};
stubAuth.entityOf = (req) => req.identity.identity_id;
stub(path.join('middleware', 'auth'), stubAuth);

/** [mount, router file, method, path, a body the route's schema accepts (so only the id is wrong), the route file's legacy error] — one row per route closed by uuidParam */
const ROUTES = [
  /* one anchor per route file still to adopt uuidParam (K-1): a file's PR adds its rows UNDER its own anchor, so parallel PRs never touch the same line */
  // ── src/routes/network.js
  // ── routes/actors.js
  // ── routes/catalogue.js
  // ── routes/channels.js
  // ── routes/chits.js
  /* the other chits routes (a 403 or 400 for an unknown id; the register ones) are proved in tests/k1-chits-guard.test.cjs, which compares each with an unknown uuid */
  ['/api/chits', 'routes/chits.js', 'DELETE', '/api/chits/abc', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'DELETE', '/api/chits/abc/payment', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'DELETE', '/api/chits/abc/purge', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'GET', '/api/chits/abc', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'GET', '/api/chits/abc/use', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/amend', { edits: [{ line_id: '44444444-4444-4444-8444-444444444444', quantity: 1 }] }, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/archive', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/assign-lines', { edits: [{ line_id: '44444444-4444-4444-8444-444444444444', assignee_id: '44444444-4444-4444-8444-444444444444' }] }, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/books-request', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/costs', { rows: [{ kind: 'fuel', amount: 5 }] }, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/deliver-lines', { rows: [{ line_id: '44444444-4444-4444-8444-444444444444', quantity: 1 }] }, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/raida', { kind: 'risk', body: 'a risk' }, 'Failed to record it'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/reprice', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/restore', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/unarchive', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'POST', '/api/chits/abc/unread', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'PUT', '/api/chits/abc/disputes/abc/resolve', { resolution_note: 'done' }, 'Dispute not found'],
  ['/api/chits', 'routes/chits.js', 'PUT', '/api/chits/abc/priority', { priority: 'high' }, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'PUT', '/api/chits/abc/priority-flag', { priority: true }, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'PUT', '/api/chits/abc/star', {}, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'PUT', '/api/chits/abc/status', { status: 'accepted' }, 'Not found'],
  ['/api/chits', 'routes/chits.js', 'PUT', '/api/chits/abc/use', {}, 'Not saved'],
  ['/api/chits', 'routes/chits.js', 'PUT', '/api/chits/abc/void', { reason: 'wrong chit' }, 'Not found'],
  // ── routes/combo-templates.js
  // ── routes/connections.js
  // ── routes/definitions.js
  // ── routes/forms.js
  // ── routes/identity-docs.js
  // ── routes/integrations.js
  // ── routes/products.js
  // ── routes/relationships.js
  // ── routes/schemas.js
];

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
new Set(ROUTES.map((r) => r[0] + '\u0000' + r[1])).forEach((key) => {
  const [mount, file] = key.split('\u0000');
  app.use(mount, require(path.join(ROOT, file)));
});

let checks = 0;
let failed = 0;
const check = (ok, label) => {
  checks++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, method, url, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ port: server.address().port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
    });
    req.end(data);
  });

(async () => {
  /* the guard itself: a uuid passes, anything else is answered with the route's words */
  const { uuidParam } = require(path.join(ROOT, 'lib', 'problem'));
  let passed = false;
  uuidParam({ detail: 'x' })({}, {}, () => (passed = true), GOOD);
  check(passed, 'uuidParam lets a uuid through');
  for (const id of ['abc', '', '1', GOOD + 'x', ' ' + GOOD]) {
    let sent = null;
    const res = { status: (s) => ((sent = { s }), res), set: () => res, json: (b) => ((sent.b = b), res), locals: {} };
    uuidParam(() => ({ detail: 'gone', legacy: { error: 'Gone' } }))({ id: 'r' }, res, () => (sent = 'next'), id);
    check(sent && sent.s === 404 && sent.b.code === 'NOT_FOUND' && sent.b.error === 'Gone', 'uuidParam answers ' + JSON.stringify(id) + ' 404 with the route words');
  }

  /* textParam (K-1 Q2): a value Postgres text cannot hold is refused 400 INVALID_INPUT naming the field; any other text passes; a file's own words win */
  const { textParam } = require(path.join(ROOT, 'lib', 'problem'));
  for (const value of ['abc', 'IN-GST-18', 'ñandú 東京', 'x'.repeat(5000), '']) {
    let through = false;
    textParam()({}, {}, () => (through = true), value, 'key');
    check(through, 'textParam lets ' + JSON.stringify(value.slice(0, 20)) + ' through');
  }
  for (const value of ['\u0000', 'a\u0000b']) {
    let sent = null;
    const res = { status: (s) => ((sent = { s }), res), set: () => res, json: (b) => ((sent.b = b), res), locals: {} };
    textParam()({ id: 'r' }, res, () => (sent = 'next'), value, 'field_key');
    check(sent && sent.s === 400 && sent.b.code === 'INVALID_INPUT' && sent.b.field === 'field_key' && !JSON.stringify(sent.b).includes('22021'), 'textParam answers ' + JSON.stringify(value) + ' 400 INVALID_INPUT naming the field');
    textParam({ status: 404, code: 'NOT_FOUND', detail: 'No such column.', legacy: { error: 'Not found' } })({ id: 'r' }, res, () => (sent = 'next'), value, 'field_key');
    check(sent && sent.s === 404 && sent.b.error === 'Not found', 'textParam with the file own words answers in them');
  }

  const server = app.listen(0);
  for (const [, , method, url, body, legacyError] of ROUTES) {
    queries.length = 0;
    const a = await ask(server, method, url, body);
    const label = method + ' ' + url.replace('/api/', '');
    check(a.status === 404, label + ' → 404 (got ' + a.status + ')');
    check(a.body.code === 'NOT_FOUND', label + ' → code NOT_FOUND (got ' + a.body.code + ')');
    check(/problem\+json/.test(a.type), label + ' → application/problem+json');
    check(!/invalid input syntax|22P02/i.test(a.text), label + ' → no driver text');
    check(queries.length === 0, label + ' → the database was never asked (' + queries.length + ')');
    if (legacyError) check(a.body.error === legacyError, label + ' → legacy error "' + legacyError + '" (got ' + a.body.error + ')');
  }
  server.close();
  console.log('\n' + checks + ' checks');
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
