/**
 * tests/limiter-answer.test.cjs — API-16 (BH-5): EVERY LIMITER ANSWERS 429 problem+json RATE_LIMITED with Retry-After.
 *
 * The real server.js is loaded (database stubbed). Every limiter it builds is tagged; each is driven past its own max on
 * a bare express app and must answer the same shape. The 240/min service limiter is also driven through the real app
 * (POST /api/integrations/heartbeat x241). Run: node tests/limiter-answer.test.cjs · no network, no DB.
 */
'use strict';
const path = require('path');
const assert = require('assert');
const http = require('http');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-limiter-answer';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { stubDatabase, loadApp } = require(path.join(API, 'tools', 'load-app.cjs'));
stubDatabase();

const rlPath = require.resolve('express-rate-limit', { paths: [API] });
const realRL = require(rlPath);
const factory = realRL.rateLimit || realRL;
const built = [];
const tagged = function (opts) { const fn = factory(opts); built.push(opts || {}); return fn; };
Object.assign(tagged, realRL);
tagged.rateLimit = tagged; tagged.default = tagged;
require.cache[rlPath].exports = tagged;

const app = loadApp();
const { limitedHandler } = require(path.join(API, 'lib', 'rate-limit.js'));
const express = require('express');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const call = (port, method, url) => new Promise((resolve, reject) => {
  const r = http.request({ port, method, path: url, headers: { 'content-type': 'application/json' } }, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); r.end(method === 'POST' ? '{}' : undefined);
});
const listen = (a) => new Promise((r) => { const s = http.createServer(a); s.listen(0, () => r(s)); });

function shape(res, label) {
  ok(res.status === 429, label + ' status 429, got ' + res.status);
  ok(/^application\/problem\+json/.test(res.headers['content-type'] || ''), label + ' content-type problem+json, got ' + res.headers['content-type']);
  let body; try { body = JSON.parse(res.body); } catch (e) { body = null; }
  ok(body && body.code === 'RATE_LIMITED', label + ' code RATE_LIMITED, got ' + res.body.slice(0, 80));
  ok(body.status === 429 && body.title && body.detail && body.hint, label + ' title, detail, hint');
  const ra = Number(res.headers['retry-after']);
  ok(Number.isFinite(ra) && ra >= 1, label + ' Retry-After seconds, got ' + res.headers['retry-after']);
  ok(body.params && body.params.retry_after_seconds === ra, label + ' body carries the same seconds');
}

(async () => {
  // 1 · the real service limiter, through the real app: 241 heartbeats in a minute
  const srv = await listen(app);
  const port = srv.address().port;
  let last;
  for (let i = 0; i < 241; i++) last = await call(port, 'POST', '/api/integrations/heartbeat');
  shape(last, 'service limiter (heartbeat #241)');
  srv.close();

  // 2 · every limiter server.js and the routes built, at a tiny max, through the same options
  ok(built.length >= 8, 'limiters were built (' + built.length + ')');
  for (const [i, opts] of built.entries()) {
    const small = Object.assign({}, opts, { max: 1, windowMs: 60000 });
    const a = express();
    a.use(factory(small));
    a.get('/x', (req, res) => res.json({ ok: true }));
    const s = await listen(a);
    const p = s.address().port;
    const first = await call(p, 'GET', '/x');
    ok(first.status === 200, 'limiter ' + i + ' lets the first through');
    const sec = await call(p, 'GET', '/x'); if (!/problem/.test(sec.headers['content-type'])) console.log('DBG', i, JSON.stringify(opts), sec.body); shape(sec, 'limiter ' + i + ' (' + (opts.max) + ')');
    s.close();
  }
  // 3 · lib/rate-limit.js alone: a refusal never throws, with or without a message, and fails closed (no Retry-After given -> 60 s, never none)
  for (const msg of [undefined, 'plain words', { error: 'Too many requests', message: 'old words' }]) {
    const sent = { headers: {}, getHeader(k) { return this.headers[k]; }, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, locals: {} };
    limitedHandler(msg)({ id: 'r1' }, sent);
    ok(sent.code === 429 && sent.body.code === 'RATE_LIMITED' && sent.headers['Retry-After'] === '60', 'unit: refused with a 60 s wait when none was given');
    ok(msg === undefined || sent.body.detail === (msg.message || msg), 'unit: the old words stay as the detail');
    ok(!msg || !msg.error || sent.body.error === 'Too many requests', 'unit: the frozen legacy error key stays');
  }
  console.log(checks + ' checks');
})().catch((e) => { console.error(e); process.exit(1); });
