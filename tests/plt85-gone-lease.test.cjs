'use strict';
/**
 * plt85-gone-lease.test.cjs — PLT-85 (open half) + PLT-87: a request keeps its place until its HANDLER has ended, a client that left is not served new work,
 * a claimed bill always runs to COMMIT, and a busy pool inside ctpaddress is 503 SERVER_BUSY, never a swallowed fallback.
 *   · admit holds the place after the client closes, up to API_ABANDON_LEASE_MS (a lease: the place is freed at the lease and a warn names the route)
 *   · the default cap is DB_POOL_MAX x 1.6 (10 gives 16); an explicit API_MAX_INFLIGHT wins; 0 is off; above 2 x the pool warns once
 *   · idempotency holdKey: a client gone BEFORE the claim leaves no claim and no handler run; gone AFTER the claim the handler runs to its end
 *   · GET/HEAD: a gone client is refused before the pool is touched (limits.refuseIfReaderGone, read by db/index.js); a mutating request is never refused there
 *   · ctpaddress: a pool timeout (pg-pool words, REAL pg-pool stack) is rethrown and read as busy by knownerr; any other error keeps the old fallback
 * REAL lib/limits, lib/problem, lib/knownerr, lib/ctpaddress, middleware/idempotency and a REAL pg-pool; db and the logger are stand-ins. No network, no database.
 * CARD 28-platform-and-operations/limits-idempotency-rate-limits
 * Run: node tests/plt85-gone-lease.test.cjs
 */
const path = require('path'), http = require('http'), express = require('express');
const Pool = require('pg-pool');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-guards';
const jwt = require('jsonwebtoken');
const stub = (rel, exports) => { const id = path.join(API, rel); require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports }; };

const warnings = [];
const logger = { warn: (m, o) => warnings.push({ m: String(m), o }), info() {}, debug() {}, error() {}, critical() {}, fellBack: (m, e) => warnings.push({ m: String(m), e }) };
stub('lib/logger', logger);
let claimAttempts = 0;
stub('db', { withEntity: async () => { claimAttempts++; throw Object.assign(new Error('no table'), { code: '42P01' }); }, query: (text, params) => dbQuery(text, params) });
let dbQuery = async () => ({ rows: [] });
stub('middleware/auth', Object.assign((req, res, next) => next(), { entityOf: () => 'shop-1' }));
const limits = require(path.join(API, 'lib', 'limits'));
const knownerr = require(path.join(API, 'lib', 'knownerr'));
const reqctx = require(path.join(API, 'lib', 'reqctx'));
const idempotency = require(path.join(API, 'middleware', 'idempotency'));
const ctpaddress = require(path.join(API, 'lib', 'ctpaddress'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const ceil = () => (typeof limits.inflightCeiling === 'function' ? limits.inflightCeiling() : 'missing');
const gate = () => (typeof limits.refuseIfReaderGone === 'function' ? limits.refuseIfReaderGone() : undefined);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const token = jwt.sign({ identity_id: 'shop-1' }, process.env.JWT_SECRET);

let handlerRuns = 0, commits = 0;
const app = express();
app.use(express.json());
const slowStageBeforeClaim = (req, res, next) => (req.headers['x-slow-stage'] ? setTimeout(next, Number(req.headers['x-slow-stage'])) : next());
app.use(limits.admit);
app.use('/api/bill', slowStageBeforeClaim);
app.use(idempotency);
const held = (req, res) => { handlerRuns++; setTimeout(() => res.json({ ok: true }), Number(req.query.ms) || 0); };
app.get('/api/hold', held);
app.post('/api/bill', async (req, res) => { handlerRuns++; await wait(300); commits++; res.json({ id: 'bill-' + commits }); });

function call(port, method, urlPath, headers, abortAfter) {
  return new Promise((resolve) => {
    const q = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: Object.assign({ authorization: 'Bearer ' + token }, headers || {}), agent: false }, (r) => {
      let b = ''; r.on('data', (c) => { b += c; });
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { j = null; } resolve({ status: r.statusCode, retryAfter: r.headers['retry-after'], body: j }); });
    });
    q.on('error', () => resolve({ status: 0 }));
    if (abortAfter) setTimeout(() => q.destroy(), abortAfter);
    q.end(method === 'POST' ? '{}' : undefined);
  });
}

/** a REAL pg-pool whose one connection is taken, so the next connect() fails with pg-pool's own timeout (own message, own stack, no code) */
async function realPoolTimeout() {
  class QuietClient { connect(cb) { const p = Promise.resolve(); return cb ? (cb(null), undefined) : p; } query() { return Promise.resolve({ rows: [] }); } end() { return Promise.resolve(); } on() { return this; } removeListener() { return this; } release() {} }
  const pool = new Pool({ max: 1, connectionTimeoutMillis: 40, Client: QuietClient });
  const taken = await pool.connect();
  try { await pool.connect(); } catch (e) { taken.release(); return e; }
  taken.release();
  return null;
}

(async () => {
  const server = app.listen(0); const port = server.address().port;

  console.log('admit: a place is kept until the handler ends, not until the client closes');
  process.env.API_MAX_INFLIGHT = '3';
  process.env.API_ABANDON_LEASE_MS = '5000';
  const three = [1, 2, 3].map(() => call(port, 'GET', '/api/hold?ms=400', null, 60));
  await wait(150);
  ok(limits.inflightNow() === 3, 'three clients have gone, their handlers still run: in flight stays 3 (got ' + limits.inflightNow() + ')');
  const fourth = await call(port, 'GET', '/api/hold');
  ok(fourth.status === 503 && fourth.body && fourth.body.code === 'SERVER_BUSY' && fourth.retryAfter === '2', 'a 4th is 503 SERVER_BUSY + Retry-After (got ' + fourth.status + ')');
  await Promise.all(three);
  await wait(400);
  ok(limits.inflightNow() === 0, 'in flight is 0 once the handlers have ended (got ' + limits.inflightNow() + ')');

  console.log('admit: 100 aborted requests give every place back within 5 s');
  process.env.API_MAX_INFLIGHT = '1000';
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 100 }, () => call(port, 'GET', '/api/hold?ms=150', null, 40)));
  while (limits.inflightNow() > 0 && Date.now() - t0 < 5000) await wait(25);
  ok(limits.inflightNow() === 0 && Date.now() - t0 < 5000, 'in flight is 0 within 5 s of the last abort (got ' + limits.inflightNow() + ' after ' + (Date.now() - t0) + ' ms)');

  console.log('admit: the lease frees the place of a client that left while its handler hangs');
  process.env.API_ABANDON_LEASE_MS = '50';
  warnings.length = 0;
  const hung = call(port, 'GET', '/api/hold?ms=700', null, 20);
  await wait(60);
  ok(limits.inflightNow() === 1, 'before the lease runs out the place is held (got ' + limits.inflightNow() + ')');
  await wait(60);
  ok(limits.inflightNow() === 0, 'after the 50 ms lease the place is free though the handler runs (got ' + limits.inflightNow() + ')');
  ok(warnings.some((w) => /abandon|lease/i.test(w.m) && /hold/.test(JSON.stringify(w.o || {}))), 'one warn line names the route');
  await hung; await wait(700);
  ok(limits.inflightNow() === 0, 'the late end of that handler does not take the count below 0 (got ' + limits.inflightNow() + ')');
  process.env.API_ABANDON_LEASE_MS = '30000';

  console.log('the default cap follows the pool');
  delete process.env.API_MAX_INFLIGHT;
  process.env.DB_POOL_MAX = '10';
  ok(ceil() === 16, 'DB_POOL_MAX 10 gives 16 (got ' + ceil() + ')');
  process.env.DB_POOL_MAX = '20';
  ok(ceil() === 32, 'DB_POOL_MAX 20 gives 32 (got ' + ceil() + ')');
  delete process.env.DB_POOL_MAX;
  ok(ceil() === 16, 'no DB_POOL_MAX: the pool default 10, so 16 (got ' + ceil() + ')');
  process.env.API_MAX_INFLIGHT = '40';
  ok(ceil() === 40, 'an explicit API_MAX_INFLIGHT wins (got ' + ceil() + ')');
  ok(warnings.some((w) => /2 x|twice/i.test(w.m)), 'a cap above 2 x the pool is warned');
  process.env.API_MAX_INFLIGHT = '0';
  ok(ceil() === 0, '0 is off');

  console.log('idempotency: gone before the claim, nothing is claimed and nothing runs; gone after it, the bill commits');
  process.env.API_MAX_INFLIGHT = '1000';
  claimAttempts = 0; handlerRuns = 0; commits = 0;
  await call(port, 'POST', '/api/bill', { 'content-type': 'application/json', 'idempotency-key': 'k-gone-early', 'x-slow-stage': '200' }, 60);
  await wait(500);
  ok(claimAttempts === 0, 'client gone before the claim: the store was not asked (calls ' + claimAttempts + ')');
  ok(handlerRuns === 0 && commits === 0, 'and the handler did not run (runs ' + handlerRuns + ')');
  claimAttempts = 0;
  await call(port, 'POST', '/api/bill', { 'content-type': 'application/json', 'idempotency-key': 'k-gone-late' }, 100);
  await wait(500);
  ok(claimAttempts === 1 && handlerRuns === 1 && commits === 1, 'client gone after the claim: the handler ran to its COMMIT once (claims ' + claimAttempts + ', commits ' + commits + ')');

  console.log('GET/HEAD gone: refused before the pool; a mutating request is never refused there');
  const locals = { clientGone: true, readerGate: true };
  let refused = null;
  reqctx.runWithRequest('r1', locals, () => { try { gate(); } catch (e) { refused = e; } });
  ok(refused && refused.clientGone === true, 'a gone GET is refused with a clientGone error (log-only)');
  refused = null;
  reqctx.runWithRequest('r2', { clientGone: true, readerGate: false }, () => { try { gate(); } catch (e) { refused = e; } });
  ok(refused === null, 'a gone POST is not refused at the pool door');
  refused = null;
  reqctx.runWithRequest('r3', { clientGone: false, readerGate: true }, () => { try { gate(); } catch (e) { refused = e; } });
  ok(refused === null, 'a GET whose client is still there is served');
  try { gate(); ok(true, 'no request in scope (a job, a test): nothing is refused'); } catch (_) { ok(false, 'no request in scope (a job, a test): nothing is refused'); }

  console.log('ctpaddress: a busy pool is busy, not "nobody is placed"');
  const poolErr = await realPoolTimeout();
  ok(poolErr && /timeout exceeded when trying to connect/.test(poolErr.message) && !poolErr.code, 'captured a real pg-pool timeout: "' + (poolErr && poolErr.message) + '", code ' + (poolErr && poolErr.code));
  ok(knownerr.isPoolBusy(poolErr) === true, 'isPoolBusy reads the real pg-pool error');
  ok(knownerr.isPoolBusy(new Error('send failed', { cause: poolErr })) === true, 'isPoolBusy reads err.cause (a wrapper that lost the stack)');
  ok(knownerr.isPoolBusy(new Error('send failed', { cause: new Error('timeout exceeded when trying to connect') })) === false, 'a cause that is not from pg is not busy');
  ctpaddress.invalidate();
  dbQuery = async () => { throw poolErr; };
  let thrown = null, answered = null;
  try { answered = await ctpaddress.remoteInstallations(true); } catch (e) { thrown = e; }
  ok(thrown === poolErr && answered === null, 'remoteInstallations rethrows the pool timeout (was: answered an empty set, "all local")');
  const asKnown = thrown && knownerr.known(thrown);
  ok(asKnown && asKnown.status === 503 && asKnown.body.code === 'SERVER_BUSY' && asKnown.body.params.retry_after_seconds === 2, 'and it is answered 503 SERVER_BUSY, Retry-After 2 (not CTP_UNRESOLVABLE, not 500)');
  /* a remote installation exists: the per-entity read is the second door */
  dbQuery = async (text) => (/FROM installation/.test(text) ? { rows: [{ installation_key: 'far-1', ctp_endpoint: 'https://far.example', region: 'x', active: true, hosted_locally: false, domain: 'far.example', label: 'Far' }] } : (() => { throw poolErr; })());
  ctpaddress.invalidate();
  thrown = null;
  try { await ctpaddress.resolve('entity-1'); } catch (e) { thrown = e; }
  ok(thrown === poolErr, 'resolve rethrows the pool timeout on the per-entity read (was: resolved:false)');
  thrown = null;
  try { await ctpaddress.resolveAll(['entity-1', 'entity-2']); } catch (e) { thrown = e; }
  ok(thrown === poolErr, 'resolveAll rethrows it too, so mint.deliver ends in fromError');
  /* any other failure keeps the answer it always had */
  dbQuery = async (text) => (/FROM installation/.test(text) ? { rows: [{ installation_key: 'far-1', ctp_endpoint: 'https://far.example', region: 'x', active: true, hosted_locally: false }] } : (() => { throw Object.assign(new Error('permission denied'), { code: '42501' }); })());
  ctpaddress.invalidate();
  const unresolved = await ctpaddress.resolve('entity-1');
  ok(unresolved.resolved === false && unresolved.local === true, 'a non-pool error is unchanged: resolved:false, nobody guessed');

  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
