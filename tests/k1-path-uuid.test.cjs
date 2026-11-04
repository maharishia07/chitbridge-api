#!/usr/bin/env node
// @type: contract
/**
 * k1-path-uuid.test.cjs — K-1 (API-10, BUG-HUNT-2026-10-31 appendix B): a write route whose address carries an id that is not a uuid answers
 * 404 NOT_FOUND as problem+json, never a 500 with the database's words, and the database is never asked.
 *
 * OWNS      the proof for every route closed through lib/problem.js uuidParam (the ONE guard), one row per route in ROUTES; a valid uuid still
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

/** [mount, router file, method, path, a body the route's schema accepts (so only the id is wrong), the route file's legacy error, its 404 code (default NOT_FOUND)] — one row per route closed by uuidParam; the code is the one an unknown uuid answers on that route (S41) */
const ROUTES = [
  /* one anchor per route file still to adopt uuidParam (K-1): a file's PR adds its rows UNDER its own anchor, so parallel PRs never touch the same line */
  // ── src/routes/network.js
  // ── routes/adopt.js
  ['/api/adopt', 'routes/adopt.js', 'GET', '/api/adopt/abc', undefined, 'Not found'],
  ['/api/adopt', 'routes/adopt.js', 'POST', '/api/adopt/abc', { accept: [{ line: 0, name: 'Tea', sku: 'T1' }] }, 'Not found'],
  // ── routes/actors.js
  // ── routes/catalogue.js
  // ── routes/channels.js
  // ── routes/chits.js
  // ── routes/combo-templates.js
  ['/api/combo-templates', 'routes/combo-templates.js', 'DELETE', '/api/combo-templates/abc', {}, 'Not found'],
  ['/api/combo-templates', 'routes/combo-templates.js', 'PATCH', '/api/combo-templates/abc', { name: 'x' }, 'Not found'],
  ['/api/combo-templates', 'routes/combo-templates.js', 'POST', '/api/combo-templates/abc/push', {}, 'Not found'],
  // ── routes/connections.js
  ['/api/connections', 'routes/connections.js', 'PUT', '/api/connections/abc/respond', { action: 'accept' }, 'Not found'],
  // ── routes/definitions.js
  // ── routes/forms.js
  ['/api/forms', 'routes/forms.js', 'POST', '/api/forms/instances/abc/sign', { name: 'R Kumar' }, 'Sign form failed', 'FORMS_NOT_FOUND'],
  ['/api/forms', 'routes/forms.js', 'POST', '/api/forms/instances/abc/attach', { chit_id: GOOD }, 'Attach form failed', 'FORMS_NOT_FOUND'],
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

  const server = app.listen(0);
  for (const [, , method, url, body, legacyError, code = 'NOT_FOUND'] of ROUTES) {
    queries.length = 0;
    const a = await ask(server, method, url, body);
    const label = method + ' ' + url.replace('/api/', '');
    check(a.status === 404, label + ' → 404 (got ' + a.status + ')');
    check(a.body.code === code, label + ' → code ' + code + ' (got ' + a.body.code + ')');
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
