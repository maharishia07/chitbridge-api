#!/usr/bin/env node
// @type: unit
/**
 * cat-277-source-owner-only.test.cjs — CAT-277 (triage 12 Nov 2026): PUT /api/assist/catalogue-source is the owner's, as the route's own comment says.
 *
 * OWNS      the proof that a co-assist (a login with a parent shop) and a key are refused 403 OWNER_ONLY in words with nothing written, and that the owner still reaches the write.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/assist.js over a stand-in sign-in and a recording db.
 * FLOW      auth stand-in sets req.identity (owner · co-assist · key) → PUT → refused before any query, or the INSERT is asked once
 * CARD      06-catalogue-pricing-offers-and-loyalty/sources
 * UNIT      06/Catalogue sources
 * MUTATION  checked once: in routes/assist.js remove the ownerOnly(...) argument of router.put('/catalogue-source') → "a co-assist is refused" goes red.
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
const STAFF = '33333333-3333-4333-8333-333333333333';
const queries = [];
const stubDb = async (sql) => { queries.push(sql); return { rows: [], rowCount: 0 }; };
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: stubDb, withEntity: async (id, fn) => fn({ query: stubDb }), onEntity: async (id, db, fn) => (typeof db === 'function' ? db({ query: stubDb }) : fn({ query: stubDb })), withTransaction: async (fn) => fn({ query: stubDb }), pool: {} } };
let who = 'owner';
const IDENTITY = { owner: { identity_id: SHOP, identity_type: 'entity' }, staff: { identity_id: STAFF, identity_type: 'actor', parent_entity_id: SHOP, hat: 'act' } };
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = IDENTITY[who === 'key' ? 'owner' : who]; if (who === 'key') req.api_key = true; next(); };
stubAuth.entityOf = (req) => (req.identity.parent_entity_id || req.identity.identity_id);
stubAuth.forgetKey = () => {};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'req-test'; next(); });
app.use('/api/assist', require(path.join(ROOT, 'routes', 'assist.js')));

let failed = 0, checks = 0;
const check = (ok, label, why) => { checks++; if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' · ' + JSON.stringify(why).slice(0, 300))); };
const put = (server, body) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const req = http.request({ port: server.address().port, method: 'PUT', path: '/api/assist/catalogue-source', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
  });
  req.end(data);
});

(async () => {
  const server = app.listen(0);
  const body = { source_key: 'brand-x@v1', title: 'Brand X', items: [{ name: 'Rice' }] };
  for (const w of ['staff', 'key']) {
    who = w; queries.length = 0;
    const r = await put(server, body);
    check(r.status === 403 && r.body.code === 'OWNER_ONLY' && /Only the owner/.test(r.body.message || r.body.detail || ''), 'a ' + (w === 'staff' ? 'co-assist' : 'key') + ' is refused 403 OWNER_ONLY in words (got ' + r.status + ')', r.text);
    check(queries.length === 0, 'a ' + (w === 'staff' ? 'co-assist' : 'key') + ' touches nothing: no query asked', queries);
  }
  who = 'owner'; queries.length = 0;
  const o = await put(server, body);
  check(o.status === 200 && o.body.authored === true && queries.some((q) => /INSERT INTO catalogue_source/.test(q)), 'the owner still authors the source (got ' + o.status + ')', o.text);
  server.close();
  say(checks + ' checks, ' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();
