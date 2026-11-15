#!/usr/bin/env node
/**
 * cat-face-save-and-read-back.test.cjs — the catalogue face (proof 2026-11-15): a saved setup is read back whole, and an unenforceable declaration is refused unsaved.
 * @type regression
 * OWNS      the proof that PUT /api/catalogue-face stores the shop's whole face and GET /api/catalogue-face answers exactly that face and its updated_at;
 *           that before any save GET answers { face: null }; that a second PUT replaces the first (one row per shop, never two); that a declaration the catalogue cannot
 *           enforce (order_input.schema field keyword `pattern`) is refused 422 in words and the stored face stays the one saved before; that a face that is not an object is a 400.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/catalogue-face.js over a stand-in db that keeps the one catalogue_face row.
 * FLOW      PUT {face} → catalogue_face upsert (stand-in row) → GET → same face · PUT {order_input.schema…pattern} → 422, row unchanged
 * CARD      06-catalogue-pim/catalogue-face
 *   node tests/cat-face-save-and-read-back.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { API, ok, done, mock, standInDb, call } = require('./lib/cat-proof-kit.cjs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const ME = '11111111-1111-4111-8111-111111111111';
const store = { row: null, writes: 0 };
const { db } = standInDb((sql, params) => {
  if (/INSERT INTO catalogue_face/.test(sql)) { store.writes++; store.row = { face: params[1], updated_at: '2026-11-15T10:00:0' + store.writes + 'Z' }; return { rows: [{ updated_at: store.row.updated_at }], rowCount: 1 }; }
  if (/FROM catalogue_face/.test(sql)) return { rows: store.row ? [store.row] : [], rowCount: store.row ? 1 : 0 };
  return null;
});
const realAuth = require(path.join(API, 'middleware', 'auth'));
mock('middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: ME, identity_type: 'entity' }; next(); }, realAuth, { entityOf: () => ME, requireScope: () => (q, s, n) => n() }));
mock('db', db); mock('db/index', db);
const realErr = console.error, realWarn = console.warn;
console.error = () => undefined; console.warn = () => undefined;

(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/catalogue-face', require(path.join(API, 'routes', 'catalogue-face.js')));
  const server = app.listen(0); const port = server.address().port;
  const put = (face) => call(port, 'PUT', '/api/catalogue-face', { face });
  try {
    const empty = await call(port, 'GET', '/api/catalogue-face');
    const FACE1 = { purpose: 'retail', units: ['kg', 'pcs'], tax: { default_slab: 'GST-5' } };
    const saved = await put(FACE1);
    const back = await call(port, 'GET', '/api/catalogue-face');
    const FACE2 = { purpose: 'wholesale', units: ['box'] };
    await put(FACE2);
    const second = await call(port, 'GET', '/api/catalogue-face');
    const before = JSON.stringify(store.row);
    const bad = await put({ purpose: 'retail', order_input: { schema: { properties: { gstin: { type: 'string', pattern: '^[0-9]{2}$' } } } } });
    const after = JSON.stringify(store.row);
    const notObj = await call(port, 'PUT', '/api/catalogue-face', { face: ['x'] });
    console.error = realErr; console.warn = realWarn;
    ok('before any save, GET answers face null and no time', empty.status === 200 && empty.body.face === null && empty.body.updated_at === null, JSON.stringify(empty.body));
    ok('PUT saves the face and says when', saved.status === 200 && saved.body.ok === true && !!saved.body.updated_at, JSON.stringify(saved.body));
    ok('GET reads back exactly the face that was saved, with its time', back.status === 200 && JSON.stringify(back.body.face) === JSON.stringify(FACE1) && back.body.updated_at === saved.body.updated_at, JSON.stringify(back.body));
    ok('a second PUT replaces the first (the whole face, one row)', JSON.stringify(second.body.face) === JSON.stringify(FACE2) && store.writes === 2, JSON.stringify([second.body, store.writes]));
    ok('an unenforceable declaration (pattern) is refused 422 in words naming the keyword', bad.status === 422 && /pattern/.test(JSON.stringify(bad.body)) && /not enforced/i.test(JSON.stringify(bad.body)), JSON.stringify([bad.status, bad.body]));
    ok('the refused save wrote nothing: the stored face is the one saved before', before === after && store.writes === 2, before + ' vs ' + after);
    ok('a face that is not an object is a 400', notObj.status === 400, JSON.stringify([notObj.status, notObj.body]));
  } finally { server.close(); }
  done();
})();
