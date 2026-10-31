#!/usr/bin/env node
// @type: contract
/**
 * cmp-22-23-input.test.cjs — CMP-22 (BH-10) and CMP-23 (BH-14): a bad identity_id on the identity-document routes and a badly typed or impossible field on POST /api/kyb/credential answer a plain 4xx, never a driver message.
 *
 * OWNS      the proof that an identity_id that is not a uuid (body or query, on /documents, /documents/:scheme/code and /verify) answers 403 IDOC_SUBJECT_FORBIDDEN problem+json (it names nobody this shop holds,
 *           the same one answer as a stranger's id), and that valid_until / standard_key / doc_key / evidence_ref / title of POST /api/kyb/credential, when not text or (for valid_until) not a real calendar day
 *           (2026-02-30 is refused), answer 400 VALIDATION_FAILED; for each: no database text in the answer and the database never asked. A real call is still answered as before.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes over a stand-in sign-in and a stand-in db that throws Postgres's own words.
 * FLOW      stub db + auth + schema → real routers on an express app → request over http → status · code · content type · no leak · queries asked
 * Run: node tests/cmp-22-23-input.test.cjs · MIN unit-per-rule · refusal-path · fail-closed (a value that cannot be read is refused before the database, never passed on)
 * CARD      21-compliance-attestation-and-trade/know-your-business
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
const OTHER = '22222222-2222-4222-8222-222222222222';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const queries = [];

/* the stand-in db: like Postgres it refuses a non-uuid with its own words and a non-date for a date column */
const run = async (sql, params) => {
  queries.push(sql);
  const list = params || [];
  if (/identity_id = \$1/.test(sql) && typeof list[0] === 'string' && !UUID.test(list[0])) throw Object.assign(new Error('invalid input syntax for type uuid: "' + list[0] + '"'), { code: '22P02' });
  if (/INSERT INTO entity_compliance/.test(sql)) {
    const day = list[5];
    if (day !== null && !(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day))) throw Object.assign(new Error('invalid input syntax for type date: "' + String(day) + '"'), { code: '22007' });
    if (day && new Date(day).toISOString().slice(0, 10) !== day) throw Object.assign(new Error('date/time field value out of range: "' + day + '"'), { code: '22008' });
  }
  return { rows: [] };
};
const stubDb = { query: run };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: run, withEntity: async (id, fn) => fn(stubDb), onEntity: async (id, db, fn) => (typeof db === 'function' ? db(stubDb) : fn(stubDb)), pool: {} } };
const schemaPath = require.resolve(path.join(ROOT, 'lib', 'schema'));
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true, exports: { hasTable: async () => true, hasColumn: async () => true, hasColumns: async () => true, checkAllows: async () => true } };
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
app.use('/api/identity', require(path.join(ROOT, 'routes', 'identity-docs.js')));
app.use('/api/kyb', require(path.join(ROOT, 'routes', 'kyb.js')));

let failed = 0;
let total = 0;
const check = (ok, label) => {
  total++;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const ask = (server, method, url, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ port: server.address().port, method, path: url, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
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
const LEAK = /invalid input syntax|22P02|22007|22008|out of range|type uuid|type date|SQLSTATE/i;

(async () => {
  const server = app.listen(0);

  /* CMP-22 · BH-10 — an identity_id that is not a uuid */
  for (const bad of ['abc', 'true', '-1', '1e21', '1; DROP TABLE x', ['a', 'b'], { a: 1 }]) {
    for (const [url, how] of [['/api/identity/documents/PHONE/code', 'body'], ['/api/identity/documents/PHONE/verify', 'body'], ['/api/identity/documents/EMAIL/code', 'query'], ['/api/identity/documents/EMAIL/verify', 'query']]) {
      if (how === 'query' && typeof bad !== 'string') continue;
      queries.length = 0;
      const a = how === 'body' ? await ask(server, 'POST', url, { identity_id: bad, code: '123456' }) : await ask(server, 'POST', url + '?identity_id=' + encodeURIComponent(bad), {});
      const label = 'POST ' + url.replace('/api/identity', '') + ' ' + how + ' identity_id=' + JSON.stringify(bad);
      check(a.status === 403, label + ' → 403 (got ' + a.status + ')');
      check(a.body.code === 'IDOC_SUBJECT_FORBIDDEN', label + ' → code IDOC_SUBJECT_FORBIDDEN (got ' + a.body.code + ')');
      check(/problem\+json/.test(a.type) && !LEAK.test(a.text), label + ' → problem+json, no driver text');
      check(queries.length === 0, label + ' → the database was never asked');
    }
  }
  queries.length = 0;
  const listBad = await ask(server, 'GET', '/api/identity/documents?identity_id=abc');
  check(listBad.status === 403 && listBad.body.code === 'IDOC_SUBJECT_FORBIDDEN' && !LEAK.test(listBad.text) && queries.length === 0, 'GET /documents?identity_id=abc → 403, no driver text, database not asked (got ' + listBad.status + ')');
  queries.length = 0;
  const own = await ask(server, 'POST', '/api/identity/documents/PHONE/code', { identity_id: SHOP });
  check(own.status === 404 && own.body.code === 'IDOC_NOT_FOUND' && queries.length > 0, 'a real call (own uuid) is still answered as before: 404 IDOC_NOT_FOUND from the database (got ' + own.status + ')');
  const stranger = await ask(server, 'POST', '/api/identity/documents/PHONE/code', { identity_id: OTHER });
  check(stranger.status === 403 && stranger.body.code === 'IDOC_SUBJECT_FORBIDDEN', 'a real uuid that is not a co-assist is still 403 IDOC_SUBJECT_FORBIDDEN (got ' + stranger.status + ')');

  /* CMP-23 · BH-14 — POST /api/kyb/credential */
  const badBodies = [
    { standard_key: 'x', doc_key: 'y', valid_until: [] },
    { standard_key: 'x', doc_key: 'y', valid_until: {} },
    { standard_key: 'x', doc_key: 'y', valid_until: 20261231 },
    { standard_key: 'x', doc_key: 'y', valid_until: 'soon' },
    { standard_key: 'x', doc_key: 'y', valid_until: '2026-02-30' },
    { standard_key: 'x', doc_key: 'y', valid_until: '2026-13-01' },
    { standard_key: 'x', doc_key: 'y', valid_until: '31/12/2026' },
    { standard_key: [], doc_key: 'y' },
    { standard_key: 'x', doc_key: { a: 1 } },
    { standard_key: 'x', doc_key: 'y', evidence_ref: [] },
    { standard_key: 'x', doc_key: 'y', evidence_ref: 5 },
    { title: ['a'] }
  ];
  for (const body of badBodies) {
    queries.length = 0;
    const a = await ask(server, 'POST', '/api/kyb/credential', body);
    const label = 'POST /credential ' + JSON.stringify(body);
    check(a.status === 400, label + ' → 400 (got ' + a.status + ')');
    check(a.body.code === 'VALIDATION_FAILED', label + ' → code VALIDATION_FAILED (got ' + a.body.code + ')');
    check(/problem\+json/.test(a.type) && !LEAK.test(a.text), label + ' → problem+json, no driver text');
    check(queries.length === 0, label + ' → the database was never asked');
  }
  const goods = [{ title: 'Village NOC' }, { standard_key: 'x', doc_key: 'y', valid_until: '2026-12-31' }, { standard_key: 'x', doc_key: 'y', valid_until: '2028-02-29', evidence_ref: 'abc' }, { standard_key: 'x', doc_key: 'y', valid_until: null }, { standard_key: 'x', doc_key: 'y', valid_until: '' }];
  for (const body of goods) {
    queries.length = 0;
    const a = await ask(server, 'POST', '/api/kyb/credential', body);
    check(a.status === 200 && a.body.added && queries.length > 0, 'a real call ' + JSON.stringify(body) + ' still adds (200, got ' + a.status + ')');
  }
  const none = await ask(server, 'POST', '/api/kyb/credential', {});
  check(none.status === 400 && none.body.code === 'KYB_BAD_REQUEST', 'an empty body still answers KYB_BAD_REQUEST as before (got ' + none.status + ' ' + none.body.code + ')');

  server.close();
  console.log(failed ? failed + ' FAILED' : total + ' checks · all passed');
  process.exit(failed ? 1 : 0);
})();
