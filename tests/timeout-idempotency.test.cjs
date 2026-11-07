'use strict';
/**
 * timeout-idempotency.test.cjs — PLT-69: a request with an Idempotency-Key that runs past REQUEST_TIMEOUT_MS still gets its 503 (the one problem
 * shape), the handler runs ONCE across the retry, a retry while it runs gets 409 IDEMPOTENCY_IN_PROGRESS, and a retry after it finished gets the
 * stored answer. REAL lib/limits + REAL middleware/idempotency (memory store: the table is "missing"). No network, no DB.
 * Run: node tests/timeout-idempotency.test.cjs
 */
const path = require('path'), http = require('http'), express = require('express');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-guards';
process.env.REQUEST_TIMEOUT_MS = '100';
process.env.OUTPUT_ALLOWLIST = 'enforce';
const jwt = require('jsonwebtoken');
const stub = (rel, exports) => { const id = path.join(API, rel); require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports }; };
stub('db', { withEntity: async () => { throw Object.assign(new Error('no table'), { code: '42P01' }); }, query: async () => ({ rows: [] }) });
stub('lib/logger', { warn() {}, info() {}, debug() {}, error() {}, critical() {}, fellBack() {} });
stub('middleware/auth', Object.assign((req, res, next) => next(), { entityOf: () => 'shop-1' })); /* auth itself is proven in idempotency-after-auth */
const limits = require(path.join(API, 'lib', 'limits'));
const { outputFilter } = require(path.join(API, 'lib', 'output-allowlist'));
const idempotency = require(path.join(API, 'middleware', 'idempotency'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const token = jwt.sign({ identity_id: 'shop-1' }, process.env.JWT_SECRET);
let runs = 0, mode = 'ok';
const app = express();
app.use(express.json());
app.use(limits.requestTimeout);
/* the route's success shape: id only (S34) — any other key is an internal field that must not leave, nor be stored */
const shape = outputFilter({ observed: 1, status: 201, schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } } } }, 'POST /api/people');
/* a stage that is slower than the deadline BEFORE the idempotency gate: the key is claimed after the 503 has gone */
const lateStage = (req, res, next) => (req.headers['x-late-claim'] ? setTimeout(next, 180) : next());
app.use('/api/people', lateStage);
app.use(idempotency);
app.post('/api/people', shape, async (req, res) => {
  runs++;
  await wait(400);
  if (mode === 'fail') return res.status(500).json({ error: 'boom' });
  res.status(201).json({ id: 'p-' + runs, internal_note: 'secret' });
});

function call(port, key, body, extra) {
  return new Promise((resolve) => {
    const t0 = Date.now(), data = Buffer.from(JSON.stringify(body || { n: 'a' }));
    const q = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/people', headers: { 'content-type': 'application/json', 'content-length': data.length, authorization: 'Bearer ' + token, 'idempotency-key': key, ...(extra || {}) } }, (r) => {
      let b = ''; r.on('data', (c) => { b += c; });
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: r.statusCode, type: r.headers['content-type'], replay: r.headers['x-idempotent-replay'], body: j, ms: Date.now() - t0 }); });
    });
    q.on('error', (e) => resolve({ status: 0, error: e.message, ms: Date.now() - t0 }));
    q.setTimeout(1500, () => { q.destroy(); });
    q.write(data); q.end();
  });
}

(async () => {
  let crashed = null;
  process.on('uncaughtException', (e) => { crashed = e; });
  process.on('unhandledRejection', (e) => { crashed = e; });
  const srv = app.listen(0); await new Promise((r) => srv.on('listening', r));
  const port = srv.address().port;

  let r = await call(port, 'k1');
  ok(r.status === 503 && r.ms < 350, 'a keyed request past the deadline gets its 503 within the limit (got ' + r.status + ' in ' + r.ms + ' ms)');
  ok(r.body && r.body.code === 'REQUEST_TIMEOUT' && r.body.status === 503 && /problem\+json/.test(r.type || '') && r.body.type && r.body.title && r.body.detail && r.body.error, 'the 503 is the one problem shape (type, title, status, code, detail) with the frozen legacy error');

  r = await call(port, 'k1');
  ok(r.status === 409 && r.body && r.body.code === 'IDEMPOTENCY_IN_PROGRESS' && runs === 1, 'a retry while the work still runs: 409 IDEMPOTENCY_IN_PROGRESS, the handler did not run again (runs=' + runs + ')');

  await wait(450);
  r = await call(port, 'k1');
  ok(r.status === 201 && r.replay === 'true' && r.body && r.body.id === 'p-1', 'the retry after the work finished gets the stored answer (got ' + r.status + ' ' + JSON.stringify(r.body) + ')');
  ok(runs === 1, 'the handler ran exactly once across all three calls (runs=' + runs + ')');

  ok(r.body && !('internal_note' in r.body), 'the replayed late answer was pruned by the output allow-list before it was stored (no internal_note)');

  /* a claim made AFTER the deadline still settles: the stage holds the request 180 ms, the 503 goes at 100 ms, then the gate claims and the route answers */
  runs = 0; mode = 'ok';
  r = await call(port, 'k3', null, { 'x-late-claim': '1' });
  ok(r.status === 503, 'k3: the 503 went before the key was claimed (got ' + r.status + ')');
  await wait(500);
  r = await call(port, 'k3');
  ok(r.status === 201 && r.replay === 'true' && r.body.id === 'p-1' && runs === 1 && !('internal_note' in r.body), 'k3: a key claimed after the deadline settled: the retry replays the pruned answer, one run (runs=' + runs + ')');

  runs = 0; mode = 'fail';
  r = await call(port, 'k2');
  ok(r.status === 503, 'a keyed request that times out and then fails still got its 503');
  await wait(450);
  r = await call(port, 'k2');
  ok(r.status === 503 && runs === 2, 'work that failed late drops the claim: the retry runs again (runs=' + runs + ')');
  await wait(450);
  ok(!crashed, 'no late-answer crash' + (crashed ? ': ' + crashed.message : ''));
  srv.close();
  console.log('\n  timeout-idempotency: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
