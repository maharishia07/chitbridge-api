'use strict';
/**
 * money-deadline.test.cjs — PLT-70: POST /api/chits/send (the till's bill door) keeps the request deadline, and the deadline cannot loop a slow till.
 * The REAL routes/chits.js, the REAL middleware/auth-first.js, the REAL lib/limits.js, mounted in server.js's order (parsers · authThenParse · requestTimeout).
 * Only the database and the sign-in are stand-ins. No network beyond 127.0.0.1.
 *  (1) SLOW BODY: a bill whose body streams for longer than the deadline still gets its 2xx (the clock starts after the body is read), and server.js mounts requestTimeout after authThenParse.
 *  (2) REPLAY ON THE REAL ROUTE: a bill whose work outlasts the deadline answers 503 REQUEST_TIMEOUT; the handler runs on and finishes once; the retry with the same client_ref is
 *      answered duplicate:true with the chit that exists, and nothing is inserted (no second chit, no second journal line).
 *  (3) THE DOORS WITH NO REPLAY keep no deadline (every other chit door, books entries, offers, invoice, bulk imports); the 15 s statement cut is DB_STATEMENT_TIMEOUT_MS.
 * Run: node tests/money-deadline.test.cjs
 */
const path = require('path'), http = require('http'), fs = require('fs'), express = require('express');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.REQUEST_TIMEOUT_MS = '400';

const SHOP = '11111111-1111-4111-8111-111111111111', CHIT = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop', bridge_id: 'TESTSHOP' };
const mock = (rel, exported) => { const file = require.resolve(path.join(API, rel)); require.cache[file] = { id: file, filename: file, loaded: true, exports: exported }; };
let inserts = 0;
const rows = (sql) => {
  if (/INSERT INTO chit_header/.test(String(sql))) inserts++;
  if (/SELECT COUNT\(/i.test(String(sql))) return { rows: [{ count: '0' }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
const client = { query: async (sql) => rows(sql) };
const known = { query: async (sql) => rows(sql), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client), onEntity: async (id, db, run) => run(client), readBatch: async (id, st) => (st || []).map(() => rows('')), trySavepoint: async (db, run, fb) => { try { return await run(db); } catch (e) { return fb; } } };
const db = new Proxy(known, { get: (t, n) => (n in t ? t[n] : typeof n === 'symbol' || n === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
mock('db', db); mock('db/index', db);
const realAuth = require(path.join(API, 'middleware', 'auth'));
const { holderOf } = require(path.join(API, 'lib', 'holder'));
const stubAuth = (req, res, next) => { req.identity = OWNER; req.api_key = { jti: 'j1', scopes: ['till'] }; req.till = holderOf({ kind: 'api_key', jti: 'j1', scopes: ['till'] }, {}, null); next(); };
mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
console.error = () => undefined;
const say = console.log;
console.log = (...p) => (typeof p[0] === 'string' && p[0].startsWith('{"t":') ? undefined : say(...p));

const limits = require(path.join(API, 'lib', 'limits'));
const authFirst = require(path.join(API, 'middleware', 'auth-first'));
const ownBill = require(path.join(API, 'lib', 'counter-bill'));
const router = require(path.join(API, 'routes', 'chits.js'));
const BILL = { recipients: [{ self: true }], purpose: 'order', client_ref: 'B-1', business_json: { till: { id: 'T-A' }, billed_at: '2026-10-23T10:00:00Z' } };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; say('  ok  ' + m); } else { fail++; say('  FAIL ' + m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST the bill; the body is written in pieces, `gapMs` apart (a slow upload) */
const send = (port, bill, pieces, gapMs, extra) => new Promise((resolve) => {
  const text = JSON.stringify(bill), size = Math.ceil(text.length / pieces);
  const q = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/chits/send', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), authorization: 'Bearer x', ...(extra || {}) } }, (r) => {
    let b = ''; r.on('data', (c) => { b += c; });
    r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: r.statusCode, body: j }); });
  });
  q.on('error', (e) => resolve({ status: 0, error: e.message }));
  (async () => { for (let i = 0; i < pieces; i++) { q.write(text.slice(i * size, (i + 1) * size)); if (i < pieces - 1) await wait(gapMs); } q.end(); })();
});

(async () => {
  /* server.js's order, read from the file */
  const src = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  const at = (re) => { const m = re.exec(src); return m ? m.index : -1; };
  const iParse = at(/app\.use\(authFirst\.authThenParse\)/), iTimeout = at(/app\.use\(require\('\.\/lib\/limits'\)\.requestTimeout\)/);
  ok(iParse > 0 && iTimeout > iParse, 'server.js mounts the request deadline AFTER the body is read (authThenParse)');

  const app = express();
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  app.use(authFirst.parsers);
  app.use(authFirst.authThenParse);
  app.use(limits.requestTimeout);
  app.use('/api/chits', router);
  const srv = app.listen(0); await new Promise((r) => srv.on('listening', r));
  const port = srv.address().port;
  const original = ownBill.byRef;

  /* (1) a body that takes 3 x 250 ms = 750 ms to arrive, deadline 400 ms: the clock starts after it */
  ownBill.byRef = async () => ({ chit_id: CHIT, till_id: 'T-A', billed_at: null });
  const t0 = Date.now();
  let r = await send(port, BILL, 4, 250);
  ok(Date.now() - t0 > 700 && r.status === 200 && r.body && r.body.chit_id === CHIT, '(1) a body streamed past the deadline still gets its 2xx (got ' + r.status + ' after ' + (Date.now() - t0) + ' ms)');

  /* (2) the work outlasts the deadline: byRef is slow the first time, answers the held chit after */
  let calls = 0, finished = 0;
  ownBill.byRef = async () => { calls++; if (calls === 1) { await wait(700); finished++; } return { chit_id: CHIT, till_id: 'T-A', billed_at: null }; };
  r = await send(port, BILL, 1, 0);
  ok(r.status === 503 && r.body && r.body.code === 'REQUEST_TIMEOUT', '(2) a bill past the deadline answers 503 REQUEST_TIMEOUT (got ' + r.status + ')');
  await wait(500);
  ok(finished === 1, '(2) the handler ran on and finished once after the 503');
  r = await send(port, BILL, 1, 0);
  ok(r.status === 200 && r.body && r.body.duplicate === true && r.body.chit_id === CHIT && r.body.client_ref === 'B-1', '(2) the retry with the same client_ref gets duplicate:true with the chit that exists (got ' + r.status + ' ' + JSON.stringify(r.body) + ')');
  ok(inserts === 0, '(2) no second chit and no second journal line were written (inserts=' + inserts + ')');
  /* (2b) an UNKEYED send (the web compose path: no client_ref, no Idempotency-Key) has no replay, so it gets no deadline and no 503 */
  ownBill.byRef = async () => { await wait(700); return null; };
  const slowUnkeyed = Object.assign({}, BILL); delete slowUnkeyed.client_ref;
  r = await send(port, slowUnkeyed, 1, 0);
  ok(r.status !== 503 && !(r.body && r.body.code === 'REQUEST_TIMEOUT'), '(2b) a slow send with neither client_ref nor Idempotency-Key gets no 503 (got ' + r.status + ')');
  /* (2c) a client_ref that is not a usable bill number, or a key the middleware ignores, is no key: still no deadline */
  const noDeadline = async (bill, header) => { const a = await send(port, bill, 1, 0, header); return a.status !== 503; };
  ok(await noDeadline(Object.assign({}, slowUnkeyed, { client_ref: '   ' })), '(2c) a whitespace client_ref is unkeyed: no 503');
  ok(await noDeadline(Object.assign({}, slowUnkeyed, { client_ref: 12345 })), '(2c) a numeric client_ref is unkeyed: no 503');
  ok(await noDeadline(slowUnkeyed, { 'idempotency-key': 'k'.repeat(require(path.join(API, 'middleware', 'idempotency')).KEY_MAX_LENGTH + 1) }), '(2c) an oversized Idempotency-Key is unkeyed: no 503');
  ownBill.byRef = original;
  srv.close();

  /* (3) the doors with no replay of their own keep no deadline */
  const bulk = (p) => limits.isBulk({ path: p });
  ok(!bulk('/api/chits/send') && !bulk('/api/chits/send/') && bulk('/api/chits/abc/amend') && bulk('/api/chits') && bulk('/api/books/entries') && bulk('/api/offers/x') && bulk('/api/invoice/x') && bulk('/api/products/import') && !bulk('/api/people'), '(3) only POST /api/chits/send is a large route that keeps the deadline');
  delete process.env.DB_STATEMENT_TIMEOUT_MS;
  ok(limits.statementTimeoutMs() === 15000 && /SET LOCAL statement_timeout/.test(fs.readFileSync(path.join(API, 'db', 'index.js'), 'utf8')), '(3) the statement cut is DB_STATEMENT_TIMEOUT_MS, 15 s by default, set on every transaction (live pg_sleep in tests/limits.test.cjs)');
  say('\n  money-deadline: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(e); process.exit(2); });
