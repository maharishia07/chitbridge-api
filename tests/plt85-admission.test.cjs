'use strict';
/**
 * plt85-admission.test.cjs — PLT-85 / SPD-45: the line is short and its end is at the door.
 *   · lib/limits admit: over API_MAX_INFLIGHT the answer is 503 SERVER_BUSY + Retry-After before any handler runs; the exempt doors pass; a request that
 *     is aborted by its client gives its place back ONCE (no leak); 0 = off; a non-number falls back to 64.
 *   · middleware/idempotency: a busy POOL (pg-pool's timeout) at the claim answers 503 SERVER_BUSY and the handler runs 0 times, nothing in the memory
 *     store; a MISSING table (42P01) keeps the LIM2 path (the handler runs once, X-Idempotency: unverified).
 *   · lib/knownerr poolBusy: the pool's words from a pg stack → 503 SERVER_BUSY; the same words from anywhere else → null.
 * REAL lib/limits, lib/problem, lib/knownerr, middleware/idempotency; db is a stand-in. No network, no database.
 * CARD 28-platform-and-operations/limits-idempotency-rate-limits
 * Run: node tests/plt85-admission.test.cjs
 */
const path = require('path'), http = require('http'), express = require('express');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-guards';
const jwt = require('jsonwebtoken');
const stub = (rel, exports) => { const id = path.join(API, rel); require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports }; };
let storeError = null;
stub('db', { withEntity: async () => { throw storeError; }, query: async () => ({ rows: [] }) });
stub('lib/logger', { warn() {}, info() {}, debug() {}, error() {}, critical() {}, fellBack() {} });
stub('middleware/auth', Object.assign((req, res, next) => next(), { entityOf: () => 'shop-1' }));
const limits = require(path.join(API, 'lib', 'limits'));
const knownerr = require(path.join(API, 'lib', 'knownerr'));
const idempotency = require(path.join(API, 'middleware', 'idempotency'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const token = jwt.sign({ identity_id: 'shop-1' }, process.env.JWT_SECRET);

let handlerRuns = 0;
const app = express();
app.use(express.json());
app.use(limits.admit);
app.use(idempotency);
/* a held request answers after ?ms=, so a test can keep places taken */
const held = (req, res) => { handlerRuns++; setTimeout(() => res.json({ ok: true }), Number(req.query.ms) || 0); };
app.get('/api/hold', held);
app.get('/health', held);
app.post('/api/ctp/deliver', held);
app.get('/api/signin/ask', held);
app.post('/api/chits/send', held);

function call(port, method, urlPath, headers, abortAfter) {
  return new Promise((resolve) => {
    const q = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: Object.assign({ authorization: 'Bearer ' + token }, headers || {}), agent: false }, (r) => {
      let b = ''; r.on('data', (c) => { b += c; });
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { j = null; } resolve({ status: r.statusCode, retryAfter: r.headers['retry-after'], type: r.headers['content-type'], unverified: r.headers['x-idempotency'], body: j }); });
    });
    q.on('error', () => resolve({ status: 0 }));
    if (abortAfter) setTimeout(() => q.destroy(), abortAfter);
    q.end(method === 'POST' ? '{}' : undefined);
  });
}

(async () => {
  const server = app.listen(0); const port = server.address().port;

  console.log('admit, cap 3: three held, the fourth is turned away');
  process.env.API_MAX_INFLIGHT = '3';
  const three = [1, 2, 3].map(() => call(port, 'GET', '/api/hold?ms=300'));
  await wait(80);
  ok(limits.inflightNow() === 3, 'in flight is 3 after three held requests (got ' + limits.inflightNow() + ')');
  const runsBefore = handlerRuns;
  const fourth = await call(port, 'GET', '/api/hold');
  ok(fourth.status === 503 && fourth.body.code === 'SERVER_BUSY', 'the 4th answers 503 SERVER_BUSY (got ' + fourth.status + ')');
  ok(fourth.retryAfter === '2' && fourth.body.params.retry_after_seconds === 2, 'Retry-After "2" in the header and 2 in params.retry_after_seconds');
  ok(/problem\+json/.test(fourth.type || ''), 'the one problem shape (application/problem+json)');
  ok(handlerRuns === runsBefore, 'the turned-away request ran no handler (runs unchanged at ' + runsBefore + ')');
  ok(limits.inflightNow() === 3, 'a turned-away request is not counted (still 3)');
  const exempt = await Promise.all([call(port, 'GET', '/health'), call(port, 'POST', '/api/ctp/deliver'), call(port, 'GET', '/api/signin/ask')]);
  ok(exempt.every((x) => x.status === 200), 'health, peer delivery and sign-in pass at 3 of 3 (statuses ' + exempt.map((x) => x.status) + ')');
  await Promise.all(three);
  ok(limits.inflightNow() === 0, 'in flight is 0 once the three finished (got ' + limits.inflightNow() + ')');
  const fifth = await call(port, 'GET', '/api/hold');
  ok(fifth.status === 200 && limits.inflightNow() === 0, 'a place freed means the next request is admitted (200)');

  console.log('admit, leak: 100 aborted by the client give their places back once');
  process.env.API_MAX_INFLIGHT = '1000';
  const aborted = Array.from({ length: 100 }, () => call(port, 'GET', '/api/hold?ms=150', null, 40));
  await Promise.all(aborted);
  await wait(300);
  ok(limits.inflightNow() === 0, 'in flight is 0 after 100 aborted requests (got ' + limits.inflightNow() + ')');

  console.log('admit, off and bad values');
  process.env.API_MAX_INFLIGHT = '0';
  const many = await Promise.all(Array.from({ length: 100 }, () => call(port, 'GET', '/api/hold?ms=50')));
  ok(many.filter((x) => x.status === 200).length === 100, 'cap 0: 100 of 100 admitted');
  process.env.API_MAX_INFLIGHT = 'abc';
  const sixtyFive = await Promise.all(Array.from({ length: 65 }, (_, i) => call(port, 'GET', '/api/hold?ms=' + (i < 64 ? 400 : 0))));
  ok(sixtyFive.filter((x) => x.status === 200).length === 64 && sixtyFive.filter((x) => x.status === 503).length === 1, 'cap "abc": falls back to 64, so 64 admitted and the 65th turned away');
  await wait(450);

  console.log('idempotency: a busy pool at the claim never runs the handler');
  process.env.API_MAX_INFLIGHT = '0';
  const poolErr = new Error('timeout exceeded when trying to connect');
  poolErr.stack = 'Error: timeout exceeded when trying to connect\n    at Timeout._onTimeout (C:\\app\\node_modules\\pg-pool\\index.js:98:27)';
  storeError = poolErr;
  let before = handlerRuns;
  const busy = await call(port, 'POST', '/api/chits/send', { 'content-type': 'application/json', 'idempotency-key': 'k-pool-1' });
  ok(busy.status === 503 && busy.body.code === 'SERVER_BUSY' && busy.retryAfter === '2', 'pool timeout at the claim: 503 SERVER_BUSY, Retry-After 2 (got ' + busy.status + ')');
  ok(handlerRuns === before, 'the handler ran 0 times');
  storeError = Object.assign(new Error('relation "idempotency_key" does not exist'), { code: '42P01' });
  before = handlerRuns;
  const missing = await call(port, 'POST', '/api/chits/send', { 'content-type': 'application/json', 'idempotency-key': 'k-pool-1' });
  ok(missing.status === 200 && handlerRuns === before + 1, 'same key with the table MISSING keeps LIM2: the handler ran once (nothing was held from the busy try)');
  ok(missing.unverified === 'unverified', 'and the answer says X-Idempotency: unverified');

  console.log('knownerr poolBusy');
  const k = knownerr.known(poolErr);
  ok(k && k.status === 503 && k.body.code === 'SERVER_BUSY' && k.body.params.retry_after_seconds === 2, 'pool words with a pg-pool stack: 503 SERVER_BUSY');
  const other = new Error('timeout exceeded when trying to connect');
  other.stack = 'Error: x\n    at somewhere (C:\\app\\lib\\mine.js:1:1)';
  ok(knownerr.known(other) === null && knownerr.isPoolBusy(other) === false, 'the same words from our own code: not renamed (null)');
  ok(knownerr.isPoolBusy(Object.assign(poolErr, { code: 'ECONNRESET' })) === false, 'a coded error is never the pool timeout');

  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
