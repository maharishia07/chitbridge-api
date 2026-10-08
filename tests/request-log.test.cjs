'use strict';
/**
 * E07 · REQUEST ID + STRUCTURED LOG + SLOW-QUERY LOG — every log line is JSON; a request id travels response ↔ log;
 * a slow statement logs ONE line with the request's id and a fingerprint — no SQL text, anywhere.
 *
 * Boots the REAL server.js on a spare port (it starts without a database; /health then says db 'down') and reads
 * its stdout. The slow-query half drives lib/dbwatch.js with a fake client, so it needs no database either.
 *
 * Run: node tests/request-log.test.cjs
 */
const fs = require('fs'), path = require('path'), http = require('http'), net = require('net'), { spawn } = require('child_process');
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
function call(port, method, p, headers, body) {
  return new Promise((resolve) => {
    const data = body == null ? null : Buffer.from(body);
    const h = Object.assign({}, headers || {}, data ? { 'content-type': 'application/json', 'content-length': data.length } : {});
    const q = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (r) => {
      let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: r.statusCode, headers: r.headers, body: j }); });
    });
    q.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) q.write(data);
    q.end();
  });
}

(async () => {
  /* ── 1 · the real server ── */
  const port = await freePort();
  const env = Object.assign({}, process.env, { PORT: String(port), LOG_LEVEL: 'info', CRM_SWEEP: '0' });
  if (!process.env.DATABASE_URL) env.DATABASE_URL = '';
  const child = spawn(process.execPath, [path.join(API, 'server.js')], { cwd: API, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { const r = await call(port, 'GET', '/health'); up = r.status === 200; if (!up) await sleep(250); }
  ok(up, 'server.js boots and answers /health on a spare port');

  try {
    let r = await call(port, 'GET', '/health', { 'X-Request-Id': 'trace-abc.123' });
    ok(r.headers['x-request-id'] === 'trace-abc.123', 'a caller\'s plain request id is echoed back');
    const pkg = require(path.join(API, 'package.json'));
    ok(r.body && r.body.version === pkg.version, '/health version comes from package.json (' + (r.body && r.body.version) + ')');
    ok(r.body && ['ok', 'slow', 'down'].indexOf(r.body.db) >= 0, '/health says how the database is: ' + (r.body && r.body.db));

    r = await call(port, 'GET', '/health');
    const minted = r.headers['x-request-id'];
    ok(UUID.test(minted || ''), 'no id given → a uuid is minted and echoed (' + minted + ')');
    r = await call(port, 'GET', '/health', { 'X-Request-Id': 'x'.repeat(100) });
    ok(UUID.test(r.headers['x-request-id'] || ''), 'an over-long id is not trusted — a uuid replaces it');
    r = await call(port, 'GET', '/health', { 'X-Request-Id': 'a"b{c}' });
    ok(UUID.test(r.headers['x-request-id'] || ''), 'an id with odd characters is not trusted — a uuid replaces it');

    r = await call(port, 'POST', '/api/crm/parties', { 'X-Request-Id': 'too-big-1' }, JSON.stringify({ pad: 'x'.repeat(300 * 1024) }));
    ok(r.status === 413 && r.body && r.body.code === 'BODY_TOO_LARGE' && r.headers['x-request-id'] === 'too-big-1', 'through the real server: 300 KB on a CRM route → 413 BODY_TOO_LARGE, id echoed (E01)');

    await sleep(300);
    const lines = out.split(/\r?\n/).filter((l) => l.trim().charAt(0) === '{');
    const parsed = lines.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } });
    ok(lines.length > 0 && parsed.every(Boolean), 'every structured log line parses as JSON (' + lines.length + ' lines)');
    const reqLines = parsed.filter((x) => x && x.msg === 'request');
    const traced = reqLines.find((x) => x.id === 'trace-abc.123');
    ok(!!traced && traced.path === '/health' && traced.status === 200 && typeof traced.ms === 'number', 'the id travels to the log: the request line for trace-abc.123 has path, status, ms');
    ok(reqLines.some((x) => x.id === minted), 'the minted uuid is the one on the log line');
    ok(reqLines.length > 0 && reqLines.every((x) => 'entity' in x && 'person' in x && 'bytes' in x && 'code' in x), 'every request line names entity, person, bytes and code');
    const big = reqLines.find((x) => x.id === 'too-big-1');
    ok(!!big && big.status === 413 && big.code === 'BODY_TOO_LARGE' && big.bytes > 300 * 1024, 'the 413 has its own log line with the code and the size');
  } finally {
    child.kill();
  }

  /* ── 2 · the slow-query log (lib/dbwatch.js) ── */
  process.env.DB_SLOW_MS = '50';
  const w = require(path.join(API, 'lib', 'dbwatch'));
  const reqctx = require(path.join(API, 'lib', 'reqctx'));
  const captured = [];
  const origLog = console.log, origErr = console.error;
  console.log = (l) => captured.push(String(l)); console.error = (l) => captured.push(String(l));
  const SECRET = "SELECT name FROM people WHERE phone = '9876543210' AND city = 'Madurai'";
  const fake = { query(text, values, cb) {
    const done = typeof values === 'function' ? values : cb;
    const isErr = /cancel_me/.test(text);
    if (done) { setTimeout(() => done(isErr ? Object.assign(new Error('canceling statement'), { code: '57014' }) : null, { rows: [] }), 80); return undefined; }
    return new Promise((res, rej) => setTimeout(() => (isErr ? rej(Object.assign(new Error('canceling statement'), { code: '57014' })) : res({ rows: [] })), 80));
  } };
  w.watch(fake);
  const locals = {};
  await reqctx.runWithRequest('req-slow-1', locals, async () => { await fake.query(SECRET); });
  await new Promise((r) => reqctx.runWithRequest('req-slow-2', {}, () => fake.query(SECRET, [], () => r())));
  await reqctx.runWithRequest('req-cancel', locals, async () => { try { await fake.query('SELECT cancel_me()'); } catch (_) {} });
  await fake.query('SELECT 1');   /* no request: id null */
  await sleep(20);
  console.log = origLog; console.error = origErr;
  const slow = captured.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  const s1 = slow.find((x) => x.msg === 'slow query' && x.id === 'req-slow-1');
  ok(!!s1 && s1.verb === 'SELECT' && /^[0-9a-f]{12}$/.test(s1.fp) && s1.ms >= 50, 'a slow statement logs ONE JSON line: request id, verb, fingerprint, ms');
  ok(slow.filter((x) => x.id === 'req-slow-1').length === 1, 'exactly one line for it');
  ok(slow.some((x) => x.msg === 'slow query' && x.id === 'req-slow-2'), 'the callback form (how pool.query calls the client) is timed too, and keeps its request id');
  ok(captured.every((l) => l.indexOf('9876543210') < 0 && l.indexOf('Madurai') < 0 && l.indexOf('FROM people') < 0), 'no SQL text and no value reaches the log — fingerprint only');
  ok(s1 && slow.find((x) => x.id === 'req-slow-2').fp === s1.fp, 'the same statement has the same fingerprint on two requests');
  ok(slow.some((x) => x.msg === 'statement timeout' && x.id === 'req-cancel') && locals.code === 'STATEMENT_TIMEOUT', 'a cancelled statement (57014) logs and puts STATEMENT_TIMEOUT on its request\'s line');
  ok(slow.some((x) => x.msg === 'slow query' && x.id === null), 'a slow statement with no request in scope still logs (id null)');
  ok(w.fingerprint("select * from t where a = 'x' and b = 7") === w.fingerprint("SELECT *  FROM t WHERE a = 'yy' AND b = 99"), 'the fingerprint ignores values, case and spacing');

  /* ── 3 · the source keeps no SQL text in a log ── */
  const dbSrc = fs.readFileSync(path.join(API, 'db', 'index.js'), 'utf8');
  ok(!/'\\nQuery:', text/.test(dbSrc) && !/text\.substring\(0, 50\)/.test(dbSrc), 'db/index.js logs a fingerprint, never the statement');
  ok(/require\('\.\.\/lib\/dbwatch'\)\.watch\(c\)/.test(dbSrc), 'every pooled connection is watched');

  console.log('\n  request-log: ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
