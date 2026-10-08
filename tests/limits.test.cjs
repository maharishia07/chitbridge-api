'use strict';
/**
 * E01 · LIMITS AND TIMEOUTS — a body larger than its route's budget is refused 413 with a code, a request past its
 * deadline answers 503 with a code (and the route's late answer goes nowhere, without crashing the process), and a
 * statement past its deadline is cancelled by Postgres and answered 503 STATEMENT_TIMEOUT.
 *
 * The HTTP checks run the REAL parsers (middleware/auth-first.js), the REAL deadline (lib/limits.js) and the REAL
 * refusal words (lib/knownerr.js) on a bare express app — server.js needs a database to boot. Its wiring ORDER is
 * checked from source. The planted pg_sleep runs only when DATABASE_URL is set.
 *
 * Run: node tests/limits.test.cjs
 */
process.env.REQUEST_TIMEOUT_MS = '300';
process.env.DB_STATEMENT_TIMEOUT_MS = process.env.DB_STATEMENT_TIMEOUT_MS || '1000';

const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
const limits = require(path.join(API, 'lib', 'limits'));
const authFirst = require(path.join(API, 'middleware', 'auth-first'));
const K = require(path.join(API, 'lib', 'knownerr'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

function app() {
  const a = express();
  a.use((req, res, next) => { res.on('finish', () => { req._logged = res.locals.code || null; a.locals.lastCode = res.locals.code || null; }); next(); });
  a.use(authFirst.parsers);
  a.use(limits.requestTimeout);
  a.post('/api/crm/parties', (req, res) => res.json({ ok: true, keys: Object.keys(req.body || {}).length }));
  a.post('/api/attachments', (req, res) => res.json({ ok: true }));
  a.get('/api/slow', async (req, res) => { await new Promise((r) => setTimeout(r, 600)); try { res.status(200).json({ late: true }); } catch (e) { res.status(500).json({ error: 'again' }); } });
  a.get('/api/products/import-slow', async (req, res) => { await new Promise((r) => setTimeout(r, 600)); res.json({ imported: true }); });
  a.get('/api/events/stream', async (req, res) => { await new Promise((r) => setTimeout(r, 600)); res.json({ streamed: true }); });
  a.use((err, req, res, next) => { const k = K.known(err); if (k) { res.locals.code = k.body.code || null; return res.status(k.status).json(k.body); } res.status(500).json({ error: 'Server error' }); });
  return a;
}

function call(port, method, p, body) {
  return new Promise((resolve) => {
    const data = body == null ? null : Buffer.from(body);
    const q = http.request({ host: '127.0.0.1', port, method, path: p, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (r) => {
      let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: r.statusCode, body: j }); });
    });
    q.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) q.write(data);
    q.end();
  });
}

const big = (bytes) => JSON.stringify({ pad: 'x'.repeat(bytes) });

(async () => {
  let crashed = null;
  process.on('uncaughtException', (e) => { crashed = e; });
  process.on('unhandledRejection', (e) => { crashed = e; });

  const a = app();
  const srv = a.listen(0); await new Promise((r) => srv.on('listening', r));
  const port = srv.address().port;

  /* ── body budgets ── */
  ok(limits.bodyLimit({ path: '/api/crm/parties' }) === '256kb' && limits.bodyLimit({ path: '/api/attachments' }) === '8mb', 'the default budget is 256kb; a listed upload route keeps 8mb');
  ok(limits.bodyLimit({ path: '/api/signin/renew' }) === '256kb' && limits.bodyLimit({ path: '/api/entities/register' }) === '256kb', 'sign-in and registration take the small budget');
  let r = await call(port, 'POST', '/api/crm/parties', big(9 * 1024 * 1024));
  ok(r.status === 413 && r.body && r.body.code === 'BODY_TOO_LARGE', 'a 9 MB body on a non-upload route → 413 BODY_TOO_LARGE (got ' + r.status + ')');
  ok(a.locals.lastCode === 'BODY_TOO_LARGE', 'and the refusal code reaches the request log (res.locals.code)');
  r = await call(port, 'POST', '/api/crm/parties', big(300 * 1024));
  ok(r.status === 413, 'a 300 KB body on a non-upload route → 413 (got ' + r.status + ')');
  r = await call(port, 'POST', '/api/crm/parties', big(1000));
  ok(r.status === 200 && r.body.ok, 'a small body still parses (got ' + r.status + ')');
  r = await call(port, 'POST', '/api/attachments', big(3 * 1024 * 1024));
  ok(r.status === 200, 'a 3 MB body on the attachments route is accepted (got ' + r.status + ')');
  r = await call(port, 'POST', '/api/attachments', big(9 * 1024 * 1024));
  ok(r.status === 413 && r.body.code === 'BODY_TOO_LARGE', 'and 9 MB is past even the large budget → 413');

  /* ── the request deadline ── */
  r = await call(port, 'GET', '/api/slow');
  ok(r.status === 503 && r.body && r.body.code === 'REQUEST_TIMEOUT', 'a request past REQUEST_TIMEOUT_MS → 503 REQUEST_TIMEOUT (got ' + r.status + ')');
  ok(a.locals.lastCode === 'REQUEST_TIMEOUT', 'the deadline\'s code reaches the request log');
  await new Promise((res) => setTimeout(res, 500));
  ok(!crashed, 'the route\'s late answer is swallowed — no ERR_HTTP_HEADERS_SENT, no crash' + (crashed ? ': ' + crashed.message : ''));
  r = await call(port, 'GET', '/api/events/stream');
  ok(r.status === 200 && r.body.streamed, 'the SSE stream has no deadline (got ' + r.status + ')');
  r = await call(port, 'GET', '/api/products/import-slow');
  ok(r.status === 200 && r.body.imported, 'a bulk route (large budget) has no request deadline — an import is never cut off mid-write (got ' + r.status + ')');

  srv.close();

  /* ── the statement deadline ── */
  const sto = K.known(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }));
  ok(sto && sto.status === 503 && sto.body.code === 'STATEMENT_TIMEOUT', '57014 (statement cancelled) → 503 STATEMENT_TIMEOUT, in words');
  ok(K.known(Object.assign(new Error('x'), { type: 'entity.too.large', status: 413, limit: 262144 })).body.message.indexOf('256 KB') >= 0, 'the 413 says the budget in KB');
  const dbSrc = fs.readFileSync(path.join(API, 'db', 'index.js'), 'utf8');
  ok(/client\.query\(beginSql\(\)\)/.test(dbSrc) && /SET LOCAL statement_timeout/.test(dbSrc), 'withTransaction sets the statement deadline on BEGIN\'s own trip');
  ok((dbSrc.match(/armPool\(new Pool\(/g) || []).length === 2, 'both pools (direct and pooler) are armed');

  /* ── server.js wiring order ── */
  const s = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  const at = (re) => { const m = re.exec(s); return m ? m.index : -1; };
  const iId = at(/res\.setHeader\('X-Request-Id'/), iLog = at(/log\.info\('request'/), iParse = at(/app\.use\(authFirst\.parsers\)/), iTo = at(/app\.use\(require\('\.\/lib\/limits'\)\.requestTimeout\)/);
  ok(iId > 0 && iLog > iId && iParse > iLog, 'server.js: request id → logger → body parsers (a 413 still gets an id and a log line)');
  ok(iTo > 0, 'server.js mounts the request deadline');
  ok(/if \(_known\) \{ res\.locals\.code = _known\.body\.code/.test(s), 'server.js: the error handler hands a known refusal\'s code to the log');

  /* ── live: a planted pg_sleep is cancelled ── */
  if (process.env.DATABASE_URL) {
    const db = require(path.join(API, 'db'));
    let code = null;
    try { await db.withTransaction((c) => c.query('SELECT pg_sleep(5)')); } catch (e) { code = e.code; }
    ok(code === '57014', 'live: pg_sleep(5) inside a transaction with a 1 s deadline is cancelled (57014; got ' + code + ')');
    try { await db.pool.end(); } catch (_) {}
  } else console.log('  --  DATABASE_URL not set: the planted pg_sleep was not run');

  console.log('\n  limits: ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
