/**
 * tests/con-159-ingest-replay.test.cjs — POST /api/connectors/ingest: A REPLAY IS ONE RECORD, A READING WITHOUT A KEY IS ALWAYS A RECORD (CON-159, 14 Nov 2026).
 *
 * Option 2, decided by industry practice: dedupe only on the caller's own key, the Idempotency-Key header (IETF draft-ietf-httpapi-idempotency-key-header, Stripe) or the body's event_id
 * (CloudEvents id: source + id). No key = no dedupe: identical sensor readings seconds apart are real events. NEVER a payload hash on this route.
 *   R1 same Idempotency-Key twice → one chit, the second is the replay   R2 same event_id twice → one chit      R3 the same bytes with NO key → TWO chits
 *   R4 the same key in two shops → two chits (the key is scoped to the device's shop)   R5 the same key with other contents → 422 IDEMPOTENCY_CONFLICT, no chit
 *   R6 a failed emit is 503 and the retry makes the chit on the SAME receipt   R7 before b852 (no idem_key column) nothing is deduplicated   R8 the header beats event_id
 * The REAL route and lib/erp-receipt.js; the database is a STAND-IN holding connector_receipt with its unique key (actor + idem_key), as tests/erp-ingest-idempotency.test.cjs does: it proves the
 * route's logic and the statements' parameters, not Postgres' own conflict handling (SIT's real-stack run).
 * Run: node tests/con-159-ingest-replay.test.cjs
 */
'use strict';
const path = require('path'), http = require('http');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'con159-test';
const SHOP_A = '11111111-1111-4111-8111-111111111111', SHOP_B = '44444444-4444-4444-8444-444444444444';
const ACTOR_A = '22222222-2222-4222-8222-222222222222', ACTOR_B = '55555555-5555-4555-8555-555555555555';
const OF = { 'key-a': { actor: ACTOR_A, shop: SHOP_A }, 'key-b': { actor: ACTOR_B, shop: SHOP_B } };

let receipts = [], keyed = true, currentKey = 'key-a';
const tidy = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const sameKey = (row, actor, value) => row.actor_id === actor && row.idem_key === value;
function receiptRows(s, p) {
  if (/^INSERT INTO connector_receipt/.test(s)) {
    const row = { receipt_id: p[0], entity_id: p[1], actor_id: p[2], doc_type: p[3], payload_hash: p[5], outcome: 'pending', chit_id: null, received_at: new Date(), idem_key: p[6] };
    if (receipts.some((held) => sameKey(held, row.actor_id, row.idem_key))) return [];
    receipts.push(row);
    return [{ receipt_id: row.receipt_id }];
  }
  if (/^SELECT receipt_id, outcome, chit_id, payload_hash, received_at FROM connector_receipt/.test(s)) return receipts.filter((r) => sameKey(r, p[0], p[1])).map((r) => ({ ...r }));
  if (/^UPDATE connector_receipt SET outcome = 'pending'/.test(s)) {
    const hit = receipts.filter((r) => sameKey(r, p[0], p[1]) && r.outcome === 'failed');
    hit.forEach((r) => { r.outcome = 'pending'; });
    return hit.map((r) => ({ receipt_id: r.receipt_id }));
  }
  if (/^UPDATE connector_receipt SET outcome = \$1, chit_id = \$2 WHERE receipt_id = \$3/.test(s)) { receipts.filter((r) => r.receipt_id === p[2]).forEach((r) => { r.outcome = p[0]; r.chit_id = p[1]; }); return []; }
  return null;
}
function rowsFor(sql, p) {
  const s = tidy(sql), mine = receiptRows(s, p);
  if (mine) return mine;
  const who = OF[currentKey];
  if (/FROM identities a LEFT JOIN identities p/.test(s)) return [{ identity_id: who.actor, parent_entity_id: who.shop, display_name: 'Pi', connector_type: 'iot', status: 'active', connector_config: {}, shop_capabilities: ['connector'] }];
  if (/SELECT capabilities FROM identities/.test(s)) return [{ capabilities: ['connector'] }];
  if (/SELECT bridge_id, display_name, currency_code, country FROM identities/.test(s)) return [{ bridge_id: 'CBSHOP', display_name: 'Shop', currency_code: 'AUD', country: 'AU' }];
  return [];
}
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p), rowCount: 1 }) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: tx.query, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), trySavepoint: async (db, fn, fallback) => { try { return await fn(db); } catch (_) { return fallback; } }, onEntity: async (id, db, fn) => fn(tx) } };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign((req, res, next) => next(), { entityOf: () => SHOP_A, requireScope: () => (q, s, n) => n() }) };
const schema = require(path.join(API, 'lib', 'schema'));
schema.hasTable = async () => true; schema.hasColumn = async (table, column) => (table === 'connector_receipt' && column === 'idem_key' ? keyed : true);
const workPattern = require.resolve(path.join(API, 'lib', 'workpattern'));
require.cache[workPattern] = { id: workPattern, filename: workPattern, loaded: true, exports: { resolveWorkPattern: async () => ({}) } };
const mint = require(path.join(API, 'lib', 'mint'));
let chits = [], deliverFails = null;
mint.deliver = async (sender, chitId) => { if (deliverFails) throw deliverFails; chits.push(chitId); };

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/connectors', require(path.join(API, 'routes', 'connectors')));

let pass = 0, fail = 0;
const ok = (what, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (extra ? '\n       ' + JSON.stringify(extra).slice(0, 500) : '')); } };
function send(server, body, headers, key) {
  currentKey = key || 'key-a';
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ method: 'POST', host: '127.0.0.1', port: server.address().port, path: '/api/connectors/ingest', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Bridge-Key': currentKey }, headers || {}) }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => { let json; try { json = JSON.parse(text); } catch (_) { json = text; } resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}
const fresh = () => { receipts = []; chits = []; deliverFails = null; keyed = true; };
const reading = (value, extra) => Object.assign({ signal: 'temp', value, unit: 'C' }, extra || {});

(async () => {
  const server = app.listen(0);
  try {
    fresh();
    const a = await send(server, reading(4), { 'Idempotency-Key': 'r-1' }), b = await send(server, reading(4), { 'Idempotency-Key': 'r-1' });
    ok('R1 the same Idempotency-Key twice → one chit; the second is a 200 replay pointing at the first chit', a.status === 200 && b.status === 200 && a.body.message === 'ingested' && b.body.message === 'duplicate' && b.body.idempotent === true && b.body.chit_id === a.body.chit_id && chits.length === 1 && receipts.length === 1, { a, b, chits });
    fresh();
    const e1 = await send(server, reading(4, { event_id: 'evt-9' })), e2 = await send(server, reading(4, { event_id: 'evt-9' }));
    ok('R2 the same event_id twice → one chit, the second is the replay', e1.status === 200 && e2.body.message === 'duplicate' && e2.body.chit_id === e1.body.chit_id && chits.length === 1, { e1, e2, chits });
    fresh();
    const n1 = await send(server, reading(4)), n2 = await send(server, reading(4));
    ok('R3 the same bytes with NO key and NO event_id twice → TWO chits, no receipt, never a duplicate', n1.body.message === 'ingested' && n2.body.message === 'ingested' && chits.length === 2 && receipts.length === 0 && n1.body.chit_id !== n2.body.chit_id, { n1, n2, chits, receipts: receipts.length });
    fresh();
    const s1 = await send(server, reading(4), { 'Idempotency-Key': 'shared' }, 'key-a'), s2 = await send(server, reading(4), { 'Idempotency-Key': 'shared' }, 'key-b');
    ok('R4 the same key in two shops → two chits, two receipts', s1.body.message === 'ingested' && s2.body.message === 'ingested' && chits.length === 2 && receipts.length === 2, { s1, s2, receipts: receipts.length });
    fresh();
    await send(server, reading(4), { 'Idempotency-Key': 'r-5' });
    const c = await send(server, reading(99), { 'Idempotency-Key': 'r-5' });
    ok('R5 the same key with other contents → 422 IDEMPOTENCY_CONFLICT, no second chit', c.status === 422 && c.body.code === 'IDEMPOTENCY_CONFLICT' && chits.length === 1, c);
    fresh(); deliverFails = new Error('chit_deliver missing');
    const f = await send(server, reading(4), { 'Idempotency-Key': 'r-6' });
    ok('R6a a failed emit is a 503 (the device keeps the event) and the receipt is failed', f.status === 503 && receipts[0].outcome === 'failed' && chits.length === 0, f);
    deliverFails = null;
    const retry = await send(server, reading(4), { 'Idempotency-Key': 'r-6' });
    ok('R6b the retry makes the chit on the SAME receipt, finished as processed', retry.status === 200 && retry.body.message === 'ingested' && chits.length === 1 && receipts.length === 1 && receipts[0].outcome === 'processed' && receipts[0].chit_id === retry.body.chit_id, { retry, receipts });
    fresh(); keyed = false;
    const p1 = await send(server, reading(4), { 'Idempotency-Key': 'r-7' }), p2 = await send(server, reading(4), { 'Idempotency-Key': 'r-7' });
    ok('R7 before b852 (no idem_key column) nothing is deduplicated and nothing is hashed: two chits', p1.status === 200 && p2.status === 200 && chits.length === 2 && receipts.length === 0, { chits, receipts: receipts.length });
    fresh();
    await send(server, reading(4, { event_id: 'evt-8' }), { 'Idempotency-Key': 'hdr-8' });
    const h2 = await send(server, reading(4, { event_id: 'evt-other' }), { 'Idempotency-Key': 'hdr-8' });
    ok('R8 the header beats event_id: the same header with another event_id is the same key (conflict on other contents), not a new reading', h2.status === 422 && chits.length === 1, h2);
    fresh();
    await send(server, reading(4, { heartbeat_only: true }), { 'Idempotency-Key': 'r-9' }); await send(server, reading(4, { heartbeat_only: true }), { 'Idempotency-Key': 'r-9' });
    ok('R9 a heartbeat-only ping raises no chit and holds no receipt', chits.length === 0 && receipts.length === 0, { receipts: receipts.length });
  } finally { server.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
