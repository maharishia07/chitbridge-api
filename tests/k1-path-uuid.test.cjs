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
process.env.CB_ADMIN_KEY = 'k1-admin-key'; /* the platform doors judge the id after their key gate */

const ROOT = path.join(__dirname, '..');
const ME = '11111111-1111-4111-8111-111111111111';
const GOOD = '33333333-3333-4333-8333-333333333333';
const DRIVER_TEXT = 'invalid input syntax for type uuid: "abc"';
const NUL_TEXT = 'invalid byte sequence for encoding "UTF8": 0x00';
const queries = [];

/* the stand-in db: like Postgres, a non-uuid value where a uuid goes gets the driver's words; nothing is ever found */
const run = async (sql, params) => {
  queries.push(sql);
  if ((params || []).some((p) => typeof p === 'string' && p.includes('\u0000'))) throw Object.assign(new Error(NUL_TEXT), { code: '22021' });
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
stubAuth.requireScope = () => (req, res, next) => next();
stub(path.join('middleware', 'auth'), stubAuth);
stub(path.join('lib', 'storage-object'), { available: async () => true, get: async () => Buffer.from(''), put: async () => undefined, del: async () => undefined, objectKey: () => 'k', NOT_OWNER: 'NOT_OWNER' }); // products: the picture store is on, so the route reaches its id
const realSchema = require(path.join(ROOT, 'lib', 'schema'));
realSchema.hasTable = async () => true; // products: parked changes are on (b203 applied), so the schedule routes reach their ids

/** [mount, router file, method, url with a junk id, url with a uuid that names nothing, body]: a junk id answers EXACTLY as the unknown uuid does (S41) where that answer is not a 404 (a list that is empty, a cancel that cancelled nothing); the database is never asked */
const SAME_ROUTES = [
  // ── same: routes/products.js
  ['/api/products', 'routes/products.js', 'GET', '/api/products/abc/schedule', '/api/products/' + GOOD + '/schedule', {}],
  ['/api/products', 'routes/products.js', 'DELETE', '/api/products/' + GOOD + '/schedule/abc', '/api/products/' + GOOD + '/schedule/' + GOOD, {}],
  ['/api/products', 'routes/products.js', 'DELETE', '/api/products/abc/schedule/abc', '/api/products/' + GOOD + '/schedule/' + GOOD, {}]
];

/** [mount, router file, method, path, a body the route's schema accepts (so only the id is wrong), the route file's legacy error, its 404 code (default NOT_FOUND)] — one row per route closed by uuidParam; the code is the one an unknown uuid answers on that route (S41) */
const ROUTES = [
  /* one anchor per route file still to adopt uuidParam (K-1): a file's PR adds its rows UNDER its own anchor, so parallel PRs never touch the same line */
  // ── routes/adopt.js
  ['/api/adopt', 'routes/adopt.js', 'GET', '/api/adopt/abc', undefined, 'Not found'],
  ['/api/adopt', 'routes/adopt.js', 'POST', '/api/adopt/abc', { accept: [{ line: 0, name: 'Tea', sku: 'T1' }] }, 'Not found'],
  // ── src/routes/network.js
  ['/api/network', 'src/routes/network.js', 'POST', '/api/network/connections/abc/approve', {}, 'edge not found', 'EDGE_NOT_FOUND'],
  ['/api/network', 'src/routes/network.js', 'POST', '/api/network/connections/abc/decline', {}, 'edge not found', 'EDGE_NOT_FOUND'],
  ['/api/network', 'src/routes/network.js', 'POST', '/api/network/connections/abc/disconnect', {}, 'edge not found', 'EDGE_NOT_FOUND'],
  ['/api/network', 'src/routes/network.js', 'POST', '/api/network/connections/abc/resume', {}, 'edge not found', 'EDGE_NOT_FOUND'],
  ['/api/network', 'src/routes/network.js', 'POST', '/api/network/connections/abc/suspend', {}, 'edge not found', 'EDGE_NOT_FOUND'],
  ['/api/network', 'src/routes/network.js', 'POST', '/api/network/entities/abc/claim', {}, 'not found'],
  ['/api/network', 'src/routes/network.js', 'GET', '/api/network/entities/abc/subtree', {}, 'not found'],
  ['/api/network', 'src/routes/network.js', 'GET', '/api/network/entities/abc/connections', {}, 'not found'],
  // ── routes/actors.js
  ['/api/actors', 'routes/actors.js', 'PUT', '/api/actors/assign/abc', { action: 'pull' }, 'Chit not found'],
  // ── routes/catalogue.js
  ['/api/catalogue', 'routes/catalogue.js', 'POST', '/api/catalogue/enquiry/abc', { message_text: 'Is this in stock?' }, 'Not found'],
  // ── routes/channels.js
  ['/api/channels', 'routes/channels.js', 'DELETE', '/api/channels/abc', {}, 'Unbind failed'],
  ['/api/channels', 'routes/channels.js', 'POST', '/api/channels/abc/provider-ref', { provider_ref: '123' }, 'Update failed'],
  ['/api/channels', 'routes/channels.js', 'POST', '/api/channels/abc/auto-raise', { on: true }, 'Auto-raise update failed'],
  ['/api/channels', 'routes/channels.js', 'POST', '/api/channels/abc/template', { name: 'x', state: 'pending' }, 'Template update failed'],
  ['/api/channels', 'routes/channels.js', 'POST', '/api/channels/abc/template-approve', { entity_id: ME, name: 'x' }, 'Template update failed'],
  ['/api/channels', 'routes/channels.js', 'POST', '/api/channels/abc/approve', {}, 'Approve failed'],
  ['/api/channels', 'routes/channels.js', 'POST', '/api/channels/abc/revoke', {}, 'Revoke failed'],
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
  ['/api/combo-templates', 'routes/combo-templates.js', 'DELETE', '/api/combo-templates/abc', {}, 'Not found'],
  ['/api/combo-templates', 'routes/combo-templates.js', 'PATCH', '/api/combo-templates/abc', { name: 'x' }, 'Not found'],
  ['/api/combo-templates', 'routes/combo-templates.js', 'POST', '/api/combo-templates/abc/push', {}, 'Not found'],
  // ── routes/connections.js
  ['/api/connections', 'routes/connections.js', 'PUT', '/api/connections/abc/respond', { action: 'accept' }, 'Not found'],
  // ── routes/definitions.js
  ['/api/definitions', 'routes/definitions.js', 'PUT', '/api/definitions/abc', { name: 'x' }, 'Not found'],
  ['/api/definitions', 'routes/definitions.js', 'DELETE', '/api/definitions/abc', {}, 'Not found'],
  // ── routes/forms.js
  ['/api/forms', 'routes/forms.js', 'POST', '/api/forms/instances/abc/sign', { name: 'R Kumar' }, 'Sign form failed', 'FORMS_NOT_FOUND'],
  ['/api/forms', 'routes/forms.js', 'POST', '/api/forms/instances/abc/attach', { chit_id: GOOD }, 'Attach form failed', 'FORMS_NOT_FOUND'],
  // ── routes/identity-docs.js
  // ── routes/integrations.js
  ['/api/integrations', 'routes/integrations.js', 'POST', '/api/integrations/abc/approve', {}, 'Not found'],
  ['/api/integrations', 'routes/integrations.js', 'POST', '/api/integrations/ask/%00/stock', {}, 'Not found'],
  // ── routes/products.js
  ['/api/products', 'routes/products.js', 'PATCH', '/api/products/abc', { item_data: { name: 'Tea' } }, 'Not found'],
  ['/api/products', 'routes/products.js', 'POST', '/api/products/abc/schedule', { item_data: { name: 'Tea' }, effective_at: '2026-12-01T00:00:00Z' }, 'Not found'],
  ['/api/products', 'routes/products.js', 'PUT', '/api/products/abc/availability', { qty: 5 }, 'Not found'],
  ['/api/products', 'routes/products.js', 'PUT', '/api/products/abc/status', { status: 'unavailable' }, 'Not found'],
  ['/api/products', 'routes/products.js', 'DELETE', '/api/products/abc', {}, 'Not found'],
  ['/api/products', 'routes/products.js', 'POST', '/api/products/abc/media', { url: 'https://youtu.be/dQw4w9WgXcQ' }, 'Not found'],
  ['/api/products', 'routes/products.js', 'DELETE', '/api/products/abc/media/m1', {}, 'Not found'],
  ['/api/products', 'routes/products.js', 'GET', '/api/products/abc/versions', {}, 'Not found'],
  ['/api/products', 'routes/products.js', 'GET', '/api/products/media/abc/m1', {}],
  // ── routes/relationships.js
  ['/api/relationships', 'routes/relationships.js', 'DELETE', '/api/relationships/suppliers/abc', undefined, 'Not found'],
  ['/api/relationships', 'routes/relationships.js', 'POST', '/api/relationships/customers/abc/groups', { groups: ['dealers'] }, 'Not found'],
  ['/api/relationships', 'routes/relationships.js', 'PATCH', '/api/relationships/suppliers/abc', { nickname: 'x' }, 'Not found'],
  ['/api/relationships', 'routes/relationships.js', 'PATCH', '/api/relationships/customers/abc', { segment_override: 'new' }, 'Not found'],
  ['/api/relationships', 'routes/relationships.js', 'GET', '/api/relationships/scorecard/abc', undefined, 'Not found'],
  ['/api/relationships', 'routes/relationships.js', 'GET', '/api/relationships/suppliers/abc/catalogue', undefined, 'Not found', 'REL_NOT_ON_YOUR_LIST'],
  // ── routes/schemas.js
];

/** TEXT rows (textParam): [mount, router file, method, url with a NUL where the handle goes, a body the route's schema accepts, headers?] — answered exactly as the same request with an unknown handle (NOSUCHSHOP), the database never asked */
const TEXT_ROUTES = [
  // ── text: routes/catalogue.js
  ['/api/catalogue', 'routes/catalogue.js', 'POST', '/api/catalogue/%00/login/verify', {identifier:'9876543210',otp:'123456'}],
  ['/api/catalogue', 'routes/catalogue.js', 'POST', '/api/catalogue/%00/support', {identifier:'9876543210',otp:'123456',observed:'it broke'}],
  ['/api/catalogue', 'routes/catalogue.js', 'POST', '/api/catalogue/%00/support/start', {identifier:'9876543210'}],
  ['/api/catalogue', 'routes/catalogue.js', 'POST', '/api/catalogue/%00/order/start', {identifier:'9876543210'}, { 'idempotency-key': 'k1-text-key-0001' }],
  ['/api/catalogue', 'routes/catalogue.js', 'POST', '/api/catalogue/%00/order/confirm', { identifier: '9876543210', otp: '654321', line_items: [{ name: 'Rice', qty: 1 }] }, { 'idempotency-key': 'k1-text-key-0001' }],
  ['/api/catalogue', 'routes/catalogue.js', 'GET', '/api/catalogue/%00', {}],
  ['/api/catalogue', 'routes/catalogue.js', 'GET', '/api/catalogue/%00/capture-fields', {}],
  ['/api/catalogue', 'routes/catalogue.js', 'GET', '/api/catalogue/%00/support/preview', {}],
  ['/api/catalogue', 'routes/catalogue.js', 'GET', '/api/catalogue/network/%00', {}],
];

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'req-test';
  next();
});
new Set(ROUTES.concat(TEXT_ROUTES).map((r) => r[0] + '\u0000' + r[1])).forEach((key) => {
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
const ask = (server, method, url, body, headers) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const req = http.request({ port: server.address().port, method, path: url, headers: { 'x-cb-admin-key': process.env.CB_ADMIN_KEY, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, (res) => {
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
  /* a NUL in a text handle: the same answer as an unknown one (S41: status, code, legacy keys, words), and Postgres is never asked */
  const shape = (a) => JSON.stringify([a.status, a.body.code, a.body.error, a.body.message, a.body.ok, a.body.why, a.body.detail, a.type]);
  for (const [, , method, url, body, headers] of TEXT_ROUTES) {
    const label = method + ' ' + url.replace('/api/', '').replace(/%00/g, '<NUL>');
    queries.length = 0;
    const junk = await ask(server, method, url, body, headers);
    const asked = queries.length;
    const unknown = await ask(server, method, url.replace(/%00/g, 'NOSUCHSHOP'), body, headers);
    check(junk.status < 500 && !/0x00|22021/.test(junk.text), label + ' → no 5xx, no driver text (got ' + junk.status + ')');
    check(asked === 0, label + ' → the database was never asked (' + asked + ')');
    check(shape(junk) === shape(unknown), label + ' → answered exactly as an unknown handle (' + shape(junk) + ' vs ' + shape(unknown) + ')');
  }
  server.close();
  /* a junk id answers EXACTLY as an unknown uuid (SAME_ROUTES), on its own server below the shared loops so sibling PRs never touch these lines */
  const sameServer = app.listen(0);
  const same = (a) => JSON.stringify([a.status, a.body.code, a.body.error, a.body.message, a.body.cancelled, a.body.enabled, a.body.pending, a.type]);
  for (const [, , method, url, goodUrl, body] of SAME_ROUTES) {
    const label = method + ' ' + url.replace('/api/', '');
    queries.length = 0;
    const junk = await ask(sameServer, method, url, body);
    const unknown = await ask(sameServer, method, goodUrl, body);
    check(junk.status < 500 && !/invalid input syntax|22P02/i.test(junk.text), label + ' → no 5xx, no driver text (got ' + junk.status + ')');
    check(same(junk) === same(unknown), label + ' → answered exactly as an unknown uuid (' + same(junk) + ' vs ' + same(unknown) + ')');
  }
  sameServer.close();
  console.log('\n' + checks + ' checks');
  console.log(failed ? failed + ' FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
})();
