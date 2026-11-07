/**
 * tests/idem3-payment-clear.test.cjs — DELETE /api/chits/:chit_id/payment ("Mark unpaid") is SAFE TO REPEAT (contract pass, 7 Nov 2026).
 * It clears the paid mark and NAMES the books entries to reverse; a retry must answer as the first did and never touch the ledger a second time.
 * Behind the same gate as Mark paid (middleware/idempotency requireKey, FIN-51); the web already sends idem:'attempt' for chitUnpay (app.html EP).
 * Hand-computed: no key → 422 IDEMPOTENCY_KEY_REQUIRED, 0 clears · key K1 → 200 'Payment cleared', 1 clear · K1 again → the same answer byte for byte
 * (X-Idempotent-Replay), still 1 clear · K1 + another chit → 422 IDEMPOTENCY_CONFLICT, still 1.
 * Offline: the real chits router, the real gate (recorder standing in for the idempotency_key table), the in-memory books harness.
 * Run: node tests/idem3-payment-clear.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111';
const BILL = 'c0000000-0000-4000-8000-00000000000f';
const OTHER = 'c0000000-0000-4000-8000-0000000000aa';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' }; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, p, key) => new Promise((done) => {
  const headers = key ? { 'Idempotency-Key': key } : {};
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'DELETE', headers }, (res) => {
    let raw = ''; res.on('data', (c) => (raw += c));
    res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { /* reads as {} */ } done({ status: res.statusCode, headers: res.headers, body: j }); });
  });
  r.end();
});
(async () => {
  console.log('\n══ idem3 · Mark unpaid is safe to repeat ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  const X = H.load({ auth: authStub });
  const rows = new Map();
  let clears = 0;
  const realQuery = X.db.query;
  X.db.query = async (text, v) => {
    const sql = String(text);
    if (/UPDATE chit_header SET business_json/.test(sql)) { clears++; return { rows: [{ chit_id: v[0] }] }; }
    if (!/idempotency_key/.test(sql)) return realQuery(text, v);
    const slot = v[0] + '\n' + (/^\s*INSERT/.test(sql) ? v[1] : /idem_key = \$3/.test(sql) ? v[2] : v[1]);
    if (/^\s*SELECT/.test(sql)) return { rows: rows.has(slot) ? [Object.assign({ expired: false }, rows.get(slot))] : [] };
    if (/^\s*INSERT/.test(sql)) { if (rows.has(slot)) return { rows: [] }; rows.set(slot, { idem_key: v[1], req_hash: v[4], state: 'in_progress', status: null, response: null }); return { rows: [{ idem_key: v[1] }] }; }
    if (/^\s*UPDATE/.test(sql)) { Object.assign(rows.get(slot), { state: 'done', status: v[2], response: JSON.parse(v[3]) }); return { rows: [] }; }
    if (/^\s*DELETE/.test(sql)) rows.delete(slot);
    return { rows: [] };
  };
  console.error = () => undefined;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/chits', require(path.join(H.API, 'routes', 'chits')));
  const srv = app.listen(0);
  const port = srv.address().port;
  const URL = '/api/chits/' + BILL + '/payment';
  try {
    const bare = await call(port, URL);
    ok('no key → 422 IDEMPOTENCY_KEY_REQUIRED, nothing cleared', bare.status === 422 && bare.body.code === 'IDEMPOTENCY_KEY_REQUIRED' && clears === 0, bare.status + ' clears ' + clears + ' ' + JSON.stringify(bare.body).slice(0, 200));
    const first = await call(port, URL, 'U1');
    ok('key U1 → 200 "Payment cleared", cleared once', first.status === 200 && first.body.message === 'Payment cleared' && clears === 1, first.status + ' clears ' + clears);
    const again = await call(port, URL, 'U1');
    ok('U1 again → the same status and body, a replay, still cleared once', again.status === first.status && JSON.stringify(again.body) === JSON.stringify(first.body) && again.headers['x-idempotent-replay'] === 'true' && clears === 1, 'clears ' + clears);
    const other = await call(port, '/api/chits/' + OTHER + '/payment', 'U1');
    ok('U1 on another chit → 422 IDEMPOTENCY_CONFLICT, still once', other.status === 422 && other.body.code === 'IDEMPOTENCY_CONFLICT' && clears === 1, other.status + ' ' + JSON.stringify(other.body).slice(0, 200));
  } finally { srv.close(); }
  console.log('\n  ' + (fail ? '✗' : '✓') + ' ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
