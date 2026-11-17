#!/usr/bin/env node
/**
 * tests/sim-load-api.test.cjs — tools/sim-load-api.cjs, the loader's door to its in-process api, as units: one request, the stop-on-error rule, the wait for /health, and the ledger hooks that are tracked and drained.
 * OWNS      the unit-per-rule, refusal-path and fail-closed proof of request, must, waitHealthy, trackHooks and drainAll (the loader itself needs a local Postgres and is proved by tests/sim-load.test.cjs's source rules and the SIT run).
 * CALLED BY scripts/guards.cjs · by hand: node tests/sim-load-api.test.cjs
 * FLOW      a local stand-in http server ──▶ request / waitHealthy ──▶ must (child process for the exit) ──▶ a stand-in books-hooks tree ──▶ trackHooks / drainAll ──▶ "<n> checks"
 * CARD      qa/sim-load
 * No database; the only socket is a throwaway server on 127.0.0.1.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const A = require(path.join(__dirname, '..', 'tools', 'sim-load-api.cjs'));

let passed = 0,
  failed = 0;
const ok = (label, condition) => {
  if (condition) passed++;
  else {
    failed++;
    console.log('   FAIL ' + label);
  }
};

/* the stop-on-error rule: a reply under 300 passes through; anything else stops the loader with exit 1 and says where */
const fine = { status: 201, b: { ok: true } };
ok('a reply under 300 is handed back as it is', A.must(fine, 'x') === fine);
const child = spawnSync(process.execPath, ['-e', "require(process.argv[1]).must({ status: 409, b: { code: 'PERIOD_LOCKED' } }, 'closing September')", path.join(__dirname, '..', 'tools', 'sim-load-api.cjs')], { encoding: 'utf8' });
ok('a refused reply stops the process with exit 1', child.status === 1);
ok('…and names the step, the status and the body', /closing September/.test(child.stderr) && /HTTP 409/.test(child.stderr) && /PERIOD_LOCKED/.test(child.stderr));

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') return res.end('ok');
    if (req.url === '/empty') return res.end('');
    if (req.url === '/echo') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      return req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization || null, key: req.headers['idempotency-key'] || null, body: raw ? JSON.parse(raw) : null }));
      });
    }
    res.statusCode = 404;
    res.end('{"code":"NOT_FOUND"}');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + server.address().port;

  const echoed = await A.request(base, '/echo', { method: 'POST', token: 'tok', headers: { 'Idempotency-Key': 'k1' }, body: { a: 1 } });
  ok('a request carries the method, the bearer token, the extra headers and the JSON body', echoed.status === 200 && echoed.b.method === 'POST' && echoed.b.auth === 'Bearer tok' && echoed.b.key === 'k1' && echoed.b.body.a === 1);
  const plain = await A.request(base, '/echo');
  ok('a request with no options is a GET with no token', plain.b.method === 'GET' && plain.b.auth === null);
  const empty = await A.request(base, '/empty');
  ok('a reply with no JSON body reads as an empty object, never a throw', empty.status === 200 && JSON.stringify(empty.b) === '{}');
  const missing = await A.request(base, '/nope');
  ok('a 404 is a reply with its status and body, for must() to refuse', missing.status === 404 && missing.b.code === 'NOT_FOUND');
  ok('waitHealthy answers true once /health answers', (await A.waitHealthy(base)) === true);
  server.close();

  /* hooks: the wrapped afterChit is kept pending until it settles, drainAll waits for it, and the answer still reaches the caller */
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'simapi-'));
  fs.mkdirSync(path.join(tree, 'lib'));
  fs.writeFileSync(path.join(tree, 'lib', 'books-hooks.js'), 'let release; exports.afterChit = () => new Promise((done) => { release = () => done("posted"); exports.release = release; });\n');
  const pending = new Set();
  A.trackHooks(tree, pending);
  const hooks = require(path.join(tree, 'lib', 'books-hooks.js'));
  const answer = hooks.afterChit();
  ok('a tracked hook is pending while it runs', pending.size === 1);
  let drained = false;
  const waiting = A.drainAll(pending).then(() => (drained = true));
  await new Promise((done) => setTimeout(done, 20));
  ok('drain waits while a hook is still running', drained === false);
  hooks.release();
  await waiting;
  ok('drain returns once the hook settled, and the hook is no longer pending', drained === true && pending.size === 0);
  ok('the caller still gets the hook\'s own answer', (await answer) === 'posted');
  fs.rmSync(tree, { recursive: true, force: true });

  console.log('\n  ' + (passed + failed) + ' checks' + (failed ? ', ' + failed + ' failed' : ', all ok'));
  process.exit(failed ? 1 : 0);
})();
