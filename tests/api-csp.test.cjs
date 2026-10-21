/**
 * tests/api-csp.test.cjs — K-SEC PR A (SEC-68, critic C11): THE API'S STRICT CSP, AND WHERE THE WEB'S CSP REPORTS.
 *
 * The REAL server.js is loaded (database stubbed, listen() made a no-op) and asked over HTTP on a local port:
 *   · a JSON answer (/health) carries default-src 'none' + frame-ancestors 'none'
 *   · /.well-known/ctp.json is still served: 200, application/json, and strict too (the critic's landing check)
 *   · the 5 old pages in public/ are served WITHOUT the strict policy, so their inline script keeps working
 *   · POST /api/csp-report takes both report shapes (report-uri and report-to), answers 204, logs shaped fields only,
 *     has a limiter of its own, and refuses a body over 8 KB
 * Run: node tests/api-csp.test.cjs · no network beyond 127.0.0.1, no DB.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-api-csp-0000000';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const q = async () => ({ rows: [], rowCount: 0 });
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: q,
    pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
    withEntity: async (id, fn) => fn(tx),
    withTransaction: async (fn) => fn(tx),
    onEntity: async (id, db, fn) => fn(tx),
    readBatch: async () => ({}),
    trySavepoint: async (db, fn, fb) => {
      try {
        return await fn(db);
      } catch (_) {
        return fb;
      }
    }
  }
};
const express = require('express');
express.application.listen = function () {
  return { close() {} };
};
/* the logger writes JSON lines to stdout: capture them to check what a report leaves in the log */
const lines = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  const s = String(chunk);
  if (s.startsWith('{"t"')) {
    lines.push(s);
    return true;
  }
  return realWrite(chunk, ...rest);
};
const quiet = console.log;
console.log = () => {};
let app;
try {
  app = require(path.join(API, 'server.js'));
} finally {
  console.log = quiet;
}

function ask(port, method, url, body, type) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(
      { host: '127.0.0.1', port, method, path: url, headers: data ? { 'Content-Type': type || 'application/json', 'Content-Length': data.length } : {} },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let pass = 0,
  fail = 0;
async function it(what, fn) {
  try {
    await fn();
    pass++;
    quiet('  ok  ' + what);
  } catch (e) {
    fail++;
    quiet('  FAIL ' + what + '\n       ' + e.message);
  }
}
const STRICT = /default-src 'none'/;

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await it("a JSON answer carries the strict policy (default-src 'none', frame-ancestors 'none')", async () => {
      const r = await ask(port, 'GET', '/health');
      const csp = r.headers['content-security-policy'] || '';
      assert.ok(STRICT.test(csp) && /frame-ancestors 'none'/.test(csp), 'policy: ' + csp);
    });
    await it('⭐ /.well-known/ctp.json is still served — 200, application/json — under the strict policy', async () => {
      const r = await ask(port, 'GET', '/.well-known/ctp.json');
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      assert.ok(/application\/json/.test(r.headers['content-type'] || ''), r.headers['content-type']);
      assert.ok(STRICT.test(r.headers['content-security-policy'] || ''));
    });
    const pages = fs.readdirSync(path.join(API, 'public')).filter((n) => /\.html$/.test(n));
    await it('the old pages are served WITHOUT the strict policy (' + pages.join(' · ') + ')', async () => {
      assert.ok(pages.length >= 5, 'expected the 5 old pages, found ' + pages.length);
      for (const name of pages) {
        const r = await ask(port, 'GET', '/' + name);
        assert.strictEqual(r.status, 200, name + ' answered ' + r.status);
        assert.ok(!STRICT.test(r.headers['content-security-policy'] || ''), name + ' got the strict policy and would lose its inline script');
      }
    });
    await it('POST /api/csp-report (report-uri shape) → 204, one shaped log line, no query string kept', async () => {
      lines.length = 0;
      const body = {
        'csp-report': {
          'document-uri': 'https://web.example/app.html?token=secret#x',
          'effective-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.example/x.js?q=1',
          'script-sample': 'alert(document.cookie)'
        }
      };
      const r = await ask(port, 'POST', '/api/csp-report', body, 'application/csp-report');
      assert.strictEqual(r.status, 204);
      const line = lines.find((s) => /csp violation/.test(s));
      assert.ok(line, 'no log line written');
      const j = JSON.parse(line);
      assert.strictEqual(j.directive, 'script-src-elem');
      assert.strictEqual(j.blocked, 'https://evil.example');
      assert.strictEqual(j.page, '/app.html');
      assert.ok(!/secret|cookie|q=1/.test(line), 'the log kept something a stranger sent: ' + line);
    });
    await it('POST /api/csp-report (report-to shape, a list) → 204', async () => {
      const body = [{ type: 'csp-violation', body: { documentURL: 'https://web.example/crm.html', effectiveDirective: 'connect-src', blockedURL: 'https://x.example/api' } }];
      const r = await ask(port, 'POST', '/api/csp-report', body, 'application/reports+json');
      assert.strictEqual(r.status, 204);
    });
    await it('anonymous on purpose: no credential is asked (401 never answered), a Bearer is never read', async () => {
      const body = { 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://img.example/a.png' } };
      const r = await ask(port, 'POST', '/api/csp-report', body, 'application/csp-report');
      assert.strictEqual(r.status, 204);
      const src = fs.readFileSync(path.join(API, 'routes', 'csp-report.js'), 'utf8');
      assert.ok(!/authorization|require\('\.\.\/middleware\/auth'\)/i.test(src), 'the report door reads a credential');
    });
    await it('replay: the same report sent twice is answered 204 twice and stores nothing (no table, no write)', async () => {
      const body = { 'csp-report': { 'effective-directive': 'font-src', 'blocked-uri': 'https://font.example/f.woff' } };
      const first = await ask(port, 'POST', '/api/csp-report', body, 'application/csp-report');
      const again = await ask(port, 'POST', '/api/csp-report', body, 'application/csp-report');
      assert.strictEqual(first.status, 204);
      assert.strictEqual(again.status, 204);
      const src = fs.readFileSync(path.join(API, 'routes', 'csp-report.js'), 'utf8');
      assert.ok(!/query\(|INSERT|UPDATE/.test(src), 'the report door writes somewhere');
    });
    await it('contract with the web: when ../chitbridge-web/vercel.json is beside this repo, its report-uri names /api/csp-report', async () => {
      const vercel = path.join(API, '..', 'chitbridge-web', 'vercel.json');
      if (!fs.existsSync(vercel)) return quiet('       (no web checkout beside this repo — contract not checked here)');
      const text = fs.readFileSync(vercel, 'utf8');
      if (!/report-uri/.test(text)) return quiet('       (the web checkout beside this repo predates K-SEC PR A — not checked)');
      assert.ok(/report-uri [^;"]*\/api\/csp-report/.test(text), 'vercel.json reports somewhere else');
    });
    await it('a report body over 8 KB is refused, never logged', async () => {
      const r = await ask(port, 'POST', '/api/csp-report', { 'csp-report': { 'blocked-uri': 'x'.repeat(9000) } }, 'application/csp-report');
      assert.ok(r.status >= 400, 'answered ' + r.status);
    });
    await it('the report door has a limiter of its own (' + require(path.join(API, 'routes', 'csp-report')).REPORTS_PER_MIN + ' a minute)', async () => {
      const src = fs.readFileSync(path.join(API, 'routes', 'csp-report.js'), 'utf8');
      assert.ok(/router\.post\('\/', reportLimiter, express\.json\(\{ type: TYPES, limit: '8kb' \}\)/.test(src));
    });
  } finally {
    server.close();
  }
  quiet('\n  ' + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
