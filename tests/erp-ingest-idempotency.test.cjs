/**
 * tests/erp-ingest-idempotency.test.cjs — POST /api/connectors/erp-ingest: ONE DOCUMENT, ONE CHIT, AND A FAILED EMIT IS NEVER A 200 (CON-ERP-IDEM, 11 Nov 2026).
 *
 * The cases the S36 machine_keyed check (tools/api-register.cjs, docs/contracts/api-hardening-scope.json) reads this file for, by their ids:
 *   K1 the same payload twice → one chit, then 'duplicate'          K4 a stale 'pending' receipt is claimed again and the chit is made
 *   K2 two different payloads → two chits                           K5 the Idempotency-Key header wins over the payload hash
 *   K3 a forced emit failure → 503, then the retry creates the chit K6 the same key with another body → 422 IDEMPOTENCY_CONFLICT
 *   + L (before b852: the hash key, a failed emit is still 503 and retried) · M (doc_ref is the key; a pending receipt still fresh is 409, never a 2xx) · N (the scope file and the contract)
 *   POST /api/connectors/erp-ingest
 * The REAL route and lib/erp-receipt.js; the database is a STAND-IN that holds connector_receipt with the unique key of the table (b852: actor+idem_key; before it: actor+payload_hash),
 * because no Postgres is installed on this runner. It proves the route's logic and the statements' parameters, not Postgres' own conflict handling: the real-stack run belongs to SIT.
 * Run: node tests/erp-ingest-idempotency.test.cjs
 */
'use strict';
const path = require('path'), http = require('http'), crypto = require('crypto');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'erp-idem-test';
const SHOP = '11111111-1111-4111-8111-111111111111', ACTOR = '22222222-2222-4222-8222-222222222222', PARTY = '33333333-3333-4333-8333-333333333333';
const ROUTE = 'POST /api/connectors/erp-ingest';
const STALE_MS = (require(path.join(API, 'middleware', 'idempotency')).IN_PROGRESS_STALE_MINUTES + 1) * 60 * 1000; /* one minute past the gate's own limit: the ONE stale limit */

/* ── the stand-in database: connector_receipt with its unique key, and what the door reads around it ── */
let receipts = [], keyed = true, reclaimSql = '', hideHeld = false;
const tidy = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const sameKey = (row, actor, column, value) => row.actor_id === actor && row[column] === value;
function insertReceipt(p, withKey) {
  const row = { receipt_id: p[0], entity_id: p[1], actor_id: p[2], doc_type: p[3], doc_ref: p[4], payload_hash: p[5], outcome: 'pending', chit_id: null, received_at: new Date(), idem_key: withKey ? p[6] : undefined };
  const clash = receipts.some((held) => (withKey ? sameKey(held, row.actor_id, 'idem_key', row.idem_key) : sameKey(held, row.actor_id, 'payload_hash', row.payload_hash)));
  if (clash) return [];
  receipts.push(row);
  return [{ receipt_id: row.receipt_id }];
}
function receiptRows(s, p) {
  if (/^INSERT INTO connector_receipt/.test(s)) return insertReceipt(p, /idem_key\)/.test(s));
  const column = /AND idem_key = \$2/.test(s) ? 'idem_key' : 'payload_hash';
  if (/^SELECT receipt_id, outcome, chit_id, payload_hash, received_at FROM connector_receipt/.test(s)) return hideHeld ? [] : receipts.filter((r) => sameKey(r, p[0], column, p[1])).map((r) => ({ ...r }));
  if (/^UPDATE connector_receipt SET outcome = 'pending'/.test(s)) {
    reclaimSql = s; /* the stand-in applies the rule itself, so K4b reads the statement's own words */
    const hit = receipts.filter((r) => sameKey(r, p[0], column, p[1]) && (r.outcome === 'failed' || (r.outcome === 'pending' && r.received_at < p[3])));
    hit.forEach((r) => { r.outcome = 'pending'; r.received_at = p[2]; });
    return hit.map((r) => ({ receipt_id: r.receipt_id }));
  }
  if (/^UPDATE connector_receipt SET outcome = \$1, chit_id = \$2 WHERE receipt_id = \$3/.test(s)) { receipts.filter((r) => r.receipt_id === p[2]).forEach((r) => { r.outcome = p[0]; r.chit_id = p[1]; }); return []; }
  return null;
}
function rowsFor(sql, p) {
  const s = tidy(sql), mine = receiptRows(s, p);
  if (mine) return mine;
  if (/FROM identities a LEFT JOIN identities p/.test(s)) return [{ identity_id: ACTOR, parent_entity_id: SHOP, display_name: 'Agent', connector_type: 'erp', status: 'active', connector_config: {}, shop_capabilities: ['connector'] }];
  if (/SELECT capabilities FROM identities/.test(s)) return [{ capabilities: ['connector'] }];
  if (/SELECT bridge_id, display_name, currency_code, country FROM identities/.test(s)) return [{ bridge_id: 'CBSHOP', display_name: 'Shop', currency_code: 'AUD', country: 'AU' }];
  if (/AS party/.test(s) && /customer_list/.test(s)) return [{ display_name: 'Party', party: p[1] === PARTY, may: p[1] === PARTY }];
  if (/SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = \$1 AND status = 'active'/.test(s)) return [{ identity_id: p[0], bridge_id: 'CBX', display_name: 'X' }];
  return [];
}
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p), rowCount: 1 }) };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: tx.query, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), trySavepoint: async (db, fn, fallback) => { try { return await fn(db); } catch (_) { return fallback; } }, onEntity: async (id, db, fn) => fn(tx) } };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign((req, res, next) => next(), { entityOf: () => SHOP, requireScope: () => (q, s, n) => n() }) };
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
function send(server, body, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ method: 'POST', host: '127.0.0.1', port: server.address().port, path: '/api/connectors/erp-ingest', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Bridge-Key': 'agent-key' }, headers || {}) }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => { let json; try { json = JSON.parse(text); } catch (_) { json = text; } resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}
const fresh = () => { receipts = []; chits = []; deliverFails = null; keyed = true; hideHeld = false; };
const doc = (amount, extra) => Object.assign({ payload: { doc_type: 'invoice', amount }, to: PARTY }, extra || {});
const hashOf = (payload) => crypto.createHash('sha256').update(require(path.join(API, 'lib', 'canon')).canon(payload)).digest('hex');

(async () => {
  const server = app.listen(0);
  try {
    console.log('— K · the cases the register reads (' + ROUTE + ') —');
    fresh();
    const first = await send(server, doc(100)), again = await send(server, doc(100));
    ok('K1 the same payload twice → one chit, the second answer is a duplicate', first.status === 200 && again.status === 200 && again.body.message === 'duplicate' && again.body.outcome === 'duplicate' && chits.length === 1 && again.body.chit_id === first.body.chit_id, { first, again, chits });
    fresh();
    await send(server, doc(100)); await send(server, doc(200));
    ok('K2 two different payloads → two chits, two receipts', chits.length === 2 && receipts.length === 2, { chits, receipts: receipts.length });
    fresh(); deliverFails = new Error('chit_deliver missing');
    const failed = await send(server, doc(100));
    ok('K3a a forced emit failure → 503 CHIT_NOT_DELIVERED (not a 200), the receipt is failed, no chit', failed.status === 503 && failed.body.code === 'CHIT_NOT_DELIVERED' && receipts[0].outcome === 'failed' && chits.length === 0, failed);
    ok('K3b … no word of the error reaches the agent', !/chit_deliver/.test(JSON.stringify(failed.body)), failed.body);
    deliverFails = null;
    const retried = await send(server, doc(100));
    ok('K3c the retry of the same document creates the chit (200, processed, not a duplicate) on the SAME receipt', retried.status === 200 && retried.body.outcome === 'processed' && chits.length === 1 && receipts.length === 1 && receipts[0].outcome === 'processed' && receipts[0].chit_id === retried.body.chit_id, { retried, receipts });
    const third = await send(server, doc(100));
    ok('K3d … and a third try is a duplicate that points at that chit', third.body.outcome === 'duplicate' && third.body.chit_id === retried.body.chit_id && chits.length === 1, third);
    fresh();
    const staleDoc = doc(100), staleHash = hashOf(staleDoc.payload);
    receipts.push({ receipt_id: 'old', entity_id: SHOP, actor_id: ACTOR, doc_type: 'invoice', doc_ref: null, payload_hash: staleHash, outcome: 'pending', chit_id: null, received_at: new Date(Date.now() - STALE_MS), idem_key: 'p:' + staleHash });
    const stale = await send(server, staleDoc);
    ok('K4 a stale pending receipt (a crash after the claim) is claimed again: the chit is made, the receipt finished', stale.status === 200 && stale.body.outcome === 'processed' && chits.length === 1 && receipts.length === 1 && receipts[0].outcome === 'processed', { stale, receipts });
    ok('K4b the re-claim statement itself names a failed receipt and a pending one older than the limit, and is one UPDATE (one winner)', reclaimSql.includes("AND (outcome = 'failed' OR (outcome = 'pending' AND received_at < $4))") && reclaimSql.includes('RETURNING receipt_id'), reclaimSql);
    fresh();
    const withKey = await send(server, doc(100), { 'Idempotency-Key': 'order-77' });
    const otherKey = await send(server, doc(100), { 'Idempotency-Key': 'order-78' });
    ok('K5 the header key wins over the hash: the same bytes under another key are another document', withKey.status === 200 && otherKey.status === 200 && otherKey.body.outcome === 'processed' && chits.length === 2 && receipts.length === 2, { chits, receipts: receipts.length });
    const replay = await send(server, doc(100), { 'Idempotency-Key': 'order-77' });
    ok('K5b … and the same key again is the duplicate', replay.body.outcome === 'duplicate' && chits.length === 2, replay);
    const other = await send(server, doc(999), { 'Idempotency-Key': 'order-77' });
    ok('K6 the same key with a different body → 422 IDEMPOTENCY_CONFLICT, no chit, no new receipt', other.status === 422 && other.body.code === 'IDEMPOTENCY_CONFLICT' && chits.length === 2 && receipts.length === 2, other);
    fresh(); await send(server, doc(100, { doc_ref: 'INV-1' }));
    const refOther = await send(server, doc(555, { doc_ref: 'INV-1' }));
    ok('K6b the same doc_ref with a different body → 422 as well', refOther.status === 422 && refOther.body.code === 'IDEMPOTENCY_CONFLICT' && chits.length === 1, refOther);

    fresh(); deliverFails = new Error('down'); await send(server, doc(100)); deliverFails = null;
    const [raceA, raceB] = await Promise.all([send(server, doc(100)), send(server, doc(100))]);
    ok('K4c two retries of a failed document at once: ONE chit is made, the other retry is told to keep it (409) or finds the done receipt, never a second chit', chits.length === 1 && [raceA, raceB].some((r) => r.status === 200 && r.body.outcome === 'processed') && [raceA, raceB].every((r) => r.status === 200 || r.status === 409) && [raceA, raceB].every((r) => !(r.status === 200 && r.body.outcome === 'duplicate' && !r.body.chit_id)), { raceA, raceB, chits });
    fresh(); receipts.push({ receipt_id: 'x', entity_id: SHOP, actor_id: ACTOR, doc_type: 'invoice', doc_ref: null, payload_hash: hashOf(doc(100).payload), outcome: 'processed', chit_id: 'c', received_at: new Date(), idem_key: 'p:' + hashOf(doc(100).payload) }); hideHeld = true;
    const unreadable = await send(server, doc(100));
    ok('K7 the receipt that blocked the claim cannot be read back: 503 (retryable), never a 200 duplicate of nothing; no chit', unreadable.status === 503 && unreadable.body.code === 'CHIT_NOT_DELIVERED' && chits.length === 0, unreadable);
    fresh();
    console.log('— L · before b852 (no idem_key column) —');
    fresh(); keyed = false; deliverFails = new Error('down');
    const legacyFail = await send(server, doc(100));
    deliverFails = null;
    const legacyRetry = await send(server, doc(100));
    const legacyDup = await send(server, doc(100));
    ok('L1 the hash is the key; a failed emit is 503 and its retry makes the chit; then a duplicate', legacyFail.status === 503 && legacyRetry.status === 200 && legacyRetry.body.outcome === 'processed' && legacyDup.body.outcome === 'duplicate' && chits.length === 1 && receipts.length === 1 && receipts[0].idem_key === undefined, { legacyFail, legacyRetry, legacyDup });

    console.log('— M · doc_ref is the key; a fresh pending receipt is not a duplicate —');
    fresh();
    const byRef = await send(server, doc(100, { doc_ref: 'INV-9' }));
    const sameRef = await send(server, doc(100, { doc_ref: 'INV-9' }));
    ok('M1 doc_ref keys the document: the same ref and body again is a duplicate, one chit', byRef.status === 200 && sameRef.body.outcome === 'duplicate' && chits.length === 1 && /^d:/.test(receipts[0].idem_key), { byRef, sameRef, key: receipts[0].idem_key });
    const creditNote = await send(server, { payload: { doc_type: 'credit_note', amount: 100 }, to: PARTY, doc_ref: 'INV-9' });
    ok('M2 the doc_type is part of the key: a credit note numbered like the invoice is another document', creditNote.status === 200 && creditNote.body.outcome === 'processed' && chits.length === 2, creditNote);
    receipts[0].outcome = 'pending'; receipts[0].received_at = new Date();
    const busy = await send(server, doc(100, { doc_ref: 'INV-9' }));
    ok('M3 a pending receipt that is still fresh answers 409 IDEMPOTENCY_IN_PROGRESS, never a 2xx the agent would drop', busy.status === 409 && busy.body.code === 'IDEMPOTENCY_IN_PROGRESS' && chits.length === 2, busy);
    fresh(); deliverFails = new Error('down');
    await send(server, doc(100, { doc_ref: 'INV-10' }));
    ok('M4 a failed receipt keeps no chit and its key is the doc_ref (so the retry finds it)', receipts.length === 1 && receipts[0].outcome === 'failed' && receipts[0].chit_id === null && /^d:/.test(receipts[0].idem_key), receipts);

    console.log('— N · the scope file and the contract —');
    const scope = require(path.join(API, 'docs', 'contracts', 'api-hardening-scope.json'));
    ok('N1 the scope file lists ' + ROUTE + ' as machine_keyed with a key order, a reason and this file', scope.machine_keyed.some((e) => e.route === ROUTE && e.key_order.length === 3 && e.test === 'tests/erp-ingest-idempotency.test.cjs'), scope.machine_keyed);
    const op = require(path.join(API, 'lib', 'connectors-contract')).OPERATIONS[ROUTE];
    ok('N2 the contract declares 422 and 503 for the door', !!op && !!op.responses['422'] && !!op.responses['503'], op && Object.keys(op.responses));
    const { identityOf } = require(path.join(API, 'lib', 'erp-receipt'));
    const pick = (more) => identityOf(Object.assign({ keyed: true, docType: 'invoice', payloadHash: 'abc' }, more));
    ok('N3 identityOf: the header beats doc_ref, doc_ref beats the hash, the hash is the last resort', pick({ idempotencyKey: 'k', docRef: 'R' }).source === 'header' && pick({ docRef: 'R' }).source === 'doc_ref' && pick({}).source === 'hash' && pick({}).value === 'p:abc');
    ok('N4 identityOf fails closed before b852: only the payload hash can identify a document, a header and a doc_ref are not trusted as a key then', pick({ keyed: false, idempotencyKey: 'k', docRef: 'R' }).column === 'payload_hash');
    ok('N6 the stale limit and the 409/422 words are the idempotency gate own (no second constant, no second sentence)', require(path.join(API, 'lib', 'erp-receipt')).PENDING_STALE_MINUTES === require(path.join(API, 'middleware', 'idempotency')).IN_PROGRESS_STALE_MINUTES && other.body.message === require(path.join(API, 'middleware', 'idempotency')).KEY_CONFLICT.message && busy.body.message === require(path.join(API, 'middleware', 'idempotency')).KEY_IN_PROGRESS.message, { conflict: other.body.message, busy: busy.body.message });
    ok('N5 identityOf: the key is a hash, never the raw header or reference, and two doc_types with one reference differ', !/order-77/.test(pick({ idempotencyKey: 'order-77' }).value) && pick({ docRef: 'R' }).value !== pick({ docRef: 'R', docType: 'credit_note' }).value);
  } finally { server.close(); }
  console.log('\n' + (fail ? 'FAIL' : 'ok') + ' — ' + pass + ' checks passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
