'use strict';
/**
 * tests/ingest-iot-offline.test.cjs — TEST-INGEST-IOT: the connector ingest doors and the device key, offline (no database, no network).
 * Fills the gaps sec3-device-keys.test.cjs leaves; the stand-in database is the same style.
 *   A  the key: none → 401 NO_KEY · unknown → 401 KEY_UNKNOWN · inactive actor → 401 · each in words, nothing minted
 *   B  /ingest: a good reading → 200 + a chit; a malformed body → 400, never 200; an unknown bridge_id → 404; a disabled one → 409
 *   C  /erp-ingest: a good payload → 200 'received'; a non-object / missing payload → 400; an IoT key → 409 in words
 *   D  replay: the same ERP payload twice (even key order changed) → ONE chit, the second answers 'duplicate' (idempotent)
 *   E  a failure is never a 200 (the answer's status says so); stats answers the three counts to the platform root
 * Run: node tests/ingest-iot-offline.test.cjs
 */
const path = require('path'), assert = require('assert'), http = require('http');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'sec3-test';
const ROOT = '99999999-9999-4999-8999-999999999999';
process.env.PLATFORM_ROOT_ENTITY = ROOT;

const SHOP = '11111111-1111-4111-8111-111111111111', ACTOR = '22222222-2222-4222-8222-222222222222';
const PARTY = '33333333-3333-4333-8333-333333333333', STRANGER = '44444444-4444-4444-8444-444444444444';

/* ── the stand-in database ── */
let S = {};
function reset() { S = { caps: ['connector'], type: 'iot', status: 'active', knownKey: true, conn: null, receipts: {}, currency: 'AUD', country: 'AU', parties: [PARTY], sql: [] }; }
function rowsFor(sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim(); S.sql.push(s);
  if (/FROM identities a LEFT JOIN identities p/.test(s)) {
    if (!S.knownKey || p[0] !== require('crypto').createHash('sha256').update('device-key-1').digest('hex')) return [];
    return [{ identity_id: ACTOR, parent_entity_id: SHOP, display_name: 'Pi', connector_type: S.type, status: S.status, connector_config: {}, shop_capabilities: S.caps }];
  }
  if (/SELECT capabilities FROM identities/.test(s)) return [{ capabilities: S.caps }];
  if (/SELECT bridge_id, display_name, currency_code, country FROM identities/.test(s))
    return [{ bridge_id: 'CBSHOP', display_name: 'Mayur', currency_code: S.currency, country: S.country }];
  if (/AS party/.test(s) && /customer_list/.test(s)) {
    const on = S.parties.indexOf(p[1]) >= 0;
    return [{ display_name: on ? 'Chola' : 'Stranger', party: on, may: on }];
  }
  if (/SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = \$1 AND status = 'active'/.test(s))
    return [{ identity_id: p[0], bridge_id: 'CBX', display_name: 'X' }];
  if (/FROM connector_connection WHERE actor_id/.test(s)) return S.conn ? [S.conn] : [];
  if (/INSERT INTO connector_receipt/.test(s)) { if (S.receipts[p[5]]) return []; S.receipts[p[5]] = { receipt_id: p[0], outcome: 'pending', chit_id: null }; return [{ receipt_id: p[0] }]; }
  if (/SELECT receipt_id, outcome, chit_id FROM connector_receipt/.test(s)) return S.receipts[p[1]] ? [S.receipts[p[1]]] : [];
  if (/UPDATE connector_receipt SET outcome/.test(s)) { const r = Object.values(S.receipts).find((x) => x.receipt_id === p[2]); if (r) { r.outcome = p[0]; r.chit_id = p[1]; } return []; }
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p), rowCount: 1 }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => ({ rows: rowsFor(s, p), rowCount: 1 }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx),
} };
let WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur' };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
const realAuth = require(authPath);   /* the real KEY_ROUTES, asked directly in C */
const allowsKey = realAuth.allowsKey;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = Object.assign({}, WHO); next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n() }) };
try { const sc = require(path.join(API, 'lib', 'schema')); sc.hasColumn = async () => true; sc.hasTable = async () => true; } catch (_) { /* schema stub is optional */ }
const wpPath = require.resolve(path.join(API, 'lib', 'workpattern'));
require.cache[wpPath] = { id: wpPath, filename: wpPath, loaded: true, exports: { resolveWorkPattern: async () => ({}) } };


const mint = require(path.join(API, 'lib', 'mint'));
let DELIVERED = [];
mint.deliver = async (sender, chit_id, copies) => { DELIVERED.push({ chit_id, copies }); };

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/connectors', require(path.join(API, 'routes', 'connectors')));
app.use('/api/events', require(path.join(API, 'routes', 'events')));

let pass = 0, fail = 0;
const ok = (what, cond, extra) => { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  FAIL ' + what + (extra ? '\n      ' + JSON.stringify(extra).slice(0, 400) : '')); } };
function call(server, method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ method, host: '127.0.0.1', port: server.address().port, path: url,
      headers: Object.assign({ 'Content-Type': 'application/json' }, data ? { 'Content-Length': Buffer.byteLength(data) } : {}, headers || {}) }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j; try { j = JSON.parse(b); } catch (_) { j = b; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const KEY = { 'X-Bridge-Key': 'device-key-1' };

(async () => {
  const server = app.listen(0);
  try {
    console.log('— A · the key —');
    reset(); DELIVERED = [];
    let r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4 });
    ok('A1 no key → 401 NO_KEY, in words', r.status === 401 && r.body.code === 'NO_KEY' && /X-Bridge-Key/.test(r.body.message), r);
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4 }, { 'X-Bridge-Key': 'wrong' });
    ok('A2 unknown key → 401 KEY_UNKNOWN', r.status === 401 && r.body.code === 'KEY_UNKNOWN' && /not recognised/.test(r.body.message), r);
    reset(); S.status = 'inactive';
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4 }, KEY);
    ok('A3 the key switched off (actor inactive) → 401, in words', r.status === 401 && r.body.code === 'KEY_UNKNOWN' && /inactive/.test(r.body.message), r);
    r = await call(server, 'POST', '/api/connectors/erp-ingest', { payload: { a: 1 } }, KEY);
    ok('A4 … /erp-ingest refuses the same way', r.status === 401, r);
    ok('A5 … nothing minted, no heartbeat written', DELIVERED.length === 0 && !S.sql.some((s) => /UPDATE identities SET last_seen/.test(s)));
    reset(); r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4, key: 'device-key-1' });
    ok('A6 the key may also ride in the body', r.status === 200, r);

    console.log('— B · /ingest —');
    reset(); DELIVERED = [];
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4, unit: 'C' }, KEY);
    ok('B1 a good reading → 200 ingested, a chit delivered', r.status === 200 && r.body.message === 'ingested' && r.body.health === 'live' && r.body.chit_id && DELIVERED.length === 1, r);
    DELIVERED = [];
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'x'.repeat(65), value: 1 }, KEY);
    ok('B2 a signal name too long → 400 Validation failed with the field named, never 200', r.status === 400 && r.body.error === 'Validation failed' && r.body.details.some((d) => d.field === 'signal'), r);
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', unit: 'u'.repeat(17) }, KEY);
    ok('B3 a unit too long → 400', r.status === 400 && r.body.details.some((d) => d.field === 'unit'), r);
    ok('B4 … a refused body minted nothing', DELIVERED.length === 0);
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4, bridge_id: 'CBNOPE' }, KEY);
    ok('B5 an unknown bridge_id → 404 in words', r.status === 404 && /No connection with that bridge_id/.test(r.body.message), r);
    S.conn = { bridge_id: 'CBDEV', enabled: false, conn_config: {}, ref: 'd1' };
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4, bridge_id: 'CBDEV' }, KEY);
    ok('B6 a disabled connection → 409 in words, nothing minted', r.status === 409 && /disabled/.test(r.body.message) && DELIVERED.length === 0, r);
    r = await call(server, 'POST', '/api/connectors/ingest', { heartbeat_only: true }, KEY);
    ok('B7 heartbeat only → 200, no chit', r.status === 200 && r.body.chit_id === null && DELIVERED.length === 0, r);

    console.log('— C · /erp-ingest —');
    reset(); S.type = 'erp'; DELIVERED = [];
    r = await call(server, 'POST', '/api/connectors/erp-ingest', { payload: { doc_type: 'invoice', doc_ref: 'INV-1', amount: 100 } }, KEY);
    ok('C1 a good Tally/Zoho payload → 200 received (a receipt, never the raw document)', r.status === 200 && r.body.message === 'received' && r.body.idempotent === false && r.body.payload_hash, r);
    ok('C2 … the raw payload was never written to the database', !S.sql.some((s) => /INV-1/.test(s)));
    for (const [what, b] of [['missing', {}], ['a string', { payload: 'x' }], ['null', { payload: null }]]) {
      r = await call(server, 'POST', '/api/connectors/erp-ingest', b, KEY);
      ok('C3 payload ' + what + ' → 400 "payload (JSON object) required", not 200', r.status === 400 && r.body.details.some((d) => d.field === 'payload' && /JSON object\) required/.test(d.message)), r);
    }
    reset(); r = await call(server, 'POST', '/api/connectors/erp-ingest', { payload: { a: 1 } }, KEY);
    ok('C4 an IoT key on /erp-ingest → 409 in words (IoT devices use /ingest)', r.status === 409 && /use \/ingest/.test(r.body.message), r);

    console.log('— D · replay is idempotent —');
    reset(); S.type = 'erp'; DELIVERED = [];
    const doc = { doc_type: 'invoice', doc_ref: 'INV-9', amount: 250, lines: [{ n: 1 }] };
    const first = await call(server, 'POST', '/api/connectors/erp-ingest', { payload: doc, to: SHOP }, KEY);
    const again = await call(server, 'POST', '/api/connectors/erp-ingest', { payload: { lines: [{ n: 1 }], amount: 250, doc_ref: 'INV-9', doc_type: 'invoice' }, to: SHOP }, KEY);
    ok('D1 the first push is received, with a chit', first.status === 200 && first.body.message === 'received' && first.body.chit_id, first);
    ok('D2 the replay (keys reordered) is 200 duplicate, same receipt, same chit', again.status === 200 && again.body.message === 'duplicate' && again.body.idempotent === true
      && again.body.receipt_id === first.body.receipt_id && again.body.chit_id === first.body.chit_id, again);
    ok('D3 ONE chit delivered for two pushes', DELIVERED.length === 1, DELIVERED.length);
    const other = await call(server, 'POST', '/api/connectors/erp-ingest', { payload: Object.assign({}, doc, { amount: 251 }), to: SHOP }, KEY);
    ok('D4 a changed document is a new receipt', other.body.message === 'received' && other.body.receipt_id !== first.body.receipt_id, other);

    console.log('— E · stats answers counts —');
    WHO = { identity_id: ROOT, identity_type: 'entity' };
    r = await call(server, 'GET', '/api/events/stats');
    ok('E1 the root reads entities · connections · tickets as numbers', r.status === 200 && ['entities', 'connections', 'tickets'].every((k) => typeof r.body[k] === 'number'), r);
    const ev = require(path.join(API, 'lib', 'events'));
    ok('E2 the route answers exactly what lib/events.stats() counts', JSON.stringify(r.body) === JSON.stringify(ev.stats()), r.body);
  } finally { server.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
