'use strict';
/**
 * money-deadline.test.cjs — PLT-70: the money doors (chits, offers, invoice, books entries) keep the request deadline though they are on the LARGE body list.
 * Proves, with the REAL lib/limits + REAL middleware/idempotency (memory store; no network, no DB):
 *  (a) a slow chit write answers 503 REQUEST_TIMEOUT at the deadline; (b) the late write still commits exactly once (the 503 does not stop the handler);
 *  (c) a retry with the same Idempotency-Key gets the first chit (replay), never a second chit or journal line; (d) the statement cut is DB_STATEMENT_TIMEOUT_MS (15 s default, live pg_sleep when DATABASE_URL is set).
 * Also: a genuinely bulk route (products import) still has no deadline.
 * Run: node tests/money-deadline.test.cjs
 */
const path = require('path'), http = require('http'), express = require('express');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-guards';
process.env.REQUEST_TIMEOUT_MS = '100';
const jwt = require('jsonwebtoken');
const stub = (rel, exports) => { const id = path.join(API, rel); require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports }; };
stub('db', { withEntity: async () => { throw Object.assign(new Error('no table'), { code: '42P01' }); }, query: async () => ({ rows: [] }) });
stub('lib/logger', { warn() {}, info() {}, debug() {}, error() {}, critical() {}, fellBack() {} });
stub('middleware/auth', Object.assign((req, res, next) => next(), { entityOf: () => 'shop-1' }));
const limits = require(path.join(API, 'lib', 'limits'));
const idempotency = require(path.join(API, 'middleware', 'idempotency'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const token = jwt.sign({ identity_id: 'shop-1' }, process.env.JWT_SECRET);
const chits = [], journal = [];
const app = express();
app.use(express.json());
app.use(limits.requestTimeout);
app.use('/api', idempotency);
app.post('/api/chits/send', async (req, res) => {
  await wait(300); /* slower than the 100 ms deadline: the 503 has gone, the write carries on */
  const id = 'c-' + (chits.length + 1); chits.push(id); journal.push('je-' + id);
  res.status(201).json({ id });
});
app.post('/api/products/import', async (req, res) => { await wait(300); res.status(200).json({ imported: 1 }); });

const call = (port, route, key) => new Promise((resolve) => {
  const data = Buffer.from('{"n":"a"}');
  const q = http.request({ host: '127.0.0.1', port, method: 'POST', path: route, headers: { 'content-type': 'application/json', 'content-length': data.length, authorization: 'Bearer ' + token, 'idempotency-key': key } }, (r) => {
    let b = ''; r.on('data', (c) => { b += c; });
    r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: r.statusCode, replay: r.headers['x-idempotent-replay'], body: j }); });
  });
  q.on('error', (e) => resolve({ status: 0, error: e.message })); q.setTimeout(1500, () => q.destroy()); q.write(data); q.end();
});

(async () => {
  const srv = app.listen(0); await new Promise((r) => srv.on('listening', r));
  const port = srv.address().port;
  const door = (p) => limits.isMoneyDoor({ path: p });
  ok(door('/api/chits/send') && door('/api/offers/send') && door('/api/invoice/x') && door('/api/books/entries') && !door('/api/books/packs') && !door('/api/products/import'), 'isMoneyDoor names the money doors and not the bulk ones');

  let r = await call(port, '/api/chits/send', 'm1');
  ok(r.status === 503 && r.body && r.body.code === 'REQUEST_TIMEOUT', '(a) a slow chit write answers 503 REQUEST_TIMEOUT at the deadline (got ' + r.status + ')');
  await wait(350);
  ok(chits.length === 1 && journal.length === 1, '(b) the late write committed exactly once after the 503 (chits=' + chits.length + ')');
  r = await call(port, '/api/chits/send', 'm1');
  ok(r.status === 201 && r.replay === 'true' && r.body && r.body.id === 'c-1', '(c) the retry with the same key gets the first chit (got ' + r.status + ' ' + JSON.stringify(r.body) + ')');
  ok(chits.length === 1 && journal.length === 1, '(c) no second chit and no second journal entry (chits=' + chits.length + ', journal=' + journal.length + ')');

  r = await call(port, '/api/products/import', 'b1');
  ok(r.status === 200, 'a bulk route (products import) still has no deadline (got ' + r.status + ')');

  delete process.env.DB_STATEMENT_TIMEOUT_MS;
  ok(limits.statementTimeoutMs() === 15000, '(d) the statement cut defaults to 15 s');
  const dbSrc = require('fs').readFileSync(path.join(API, 'db', 'index.js'), 'utf8');
  ok(/SET LOCAL statement_timeout/.test(dbSrc), '(d) every transaction sets the statement cut on BEGIN');
  if (process.env.DATABASE_URL) {
    process.env.DB_STATEMENT_TIMEOUT_MS = '1000';
    delete require.cache[require.resolve(path.join(API, 'db'))];
    const db = require(path.join(API, 'db'));
    let code = null;
    try { await db.withTransaction((c) => c.query('SELECT pg_sleep(5)')); } catch (e) { code = e.code; }
    ok(code === '57014', '(d) live: a statement past the cut is cancelled and rolled back (57014; got ' + code + ')');
    try { await db.pool.end(); } catch (_) {}
  } else console.log('  --  DATABASE_URL not set: the live pg_sleep cut is proven by tests/limits.test.cjs on the box');
  srv.close();
  console.log('\n  money-deadline: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
