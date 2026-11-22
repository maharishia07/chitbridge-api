'use strict';
/**
 * tests/rate-limit-identity.test.cjs — T-F-02 (batch 1129). The general limiter counts a SIGNED-IN person on their own budget, a stranger per address,
 * and a per-address ceiling sits above both. Real server.js, database stubbed, tiny budgets set through the environment (read when server.js loads).
 * Fails before the change: two people behind one address shared one 500 bucket. Run: node tests/rate-limit-identity.test.cjs · no network, no DB.
 */
const path = require('path');
const assert = require('assert');
const http = require('http');
const API = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-only-secret-rate-limit-identity', NODE_ENV: 'test', LOG_LEVEL: 'error', RATE_LIMIT_USER_MAX: '5', RATE_LIMIT_MAX: '3', RATE_LIMIT_IP_MAX: '12', AUTH_RATE_LIMIT_MAX: '4' });
const { stubDatabase, loadApp } = require(path.join(API, 'tools', 'load-app.cjs'));
stubDatabase();
const jwt = require('jsonwebtoken');
const app = loadApp();
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; console.log('  ok  ' + m); };
const tokenFor = (id, jti) => jwt.sign({ identity_id: id, jti, kind: 'person' }, process.env.JWT_SECRET);
const call = (port, method, url, headers) => new Promise((resolve, reject) => {
  const r = http.request({ port, method, path: url, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) }, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); r.end(method === 'POST' ? '{}' : undefined);
});
const limited = (r) => r.status === 429;

(async () => {
  const srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, () => r(s)); });
  const port = srv.address().port;
  const A = { authorization: 'Bearer ' + tokenFor('aaaa-1', 's1') };
  const A2 = { authorization: 'Bearer ' + tokenFor('aaaa-1', 's2') }; /* the same person, another session */
  const B = { authorization: 'Bearer ' + tokenFor('bbbb-2', 's9') };

  // 1 · person A spends their 5; the 6th is refused; person B, SAME address, still has a full budget
  let a; for (let i = 0; i < 5; i++) { a = await call(port, 'GET', '/api/zz-no-such-route', A); ok(!limited(a), 'person A call ' + (i + 1) + ' passes'); }
  ok(a.headers['ratelimit-limit'] === '5' && a.headers['ratelimit-remaining'] === '0', 'RateLimit-Limit/Remaining on an ordinary answer: ' + a.headers['ratelimit-limit'] + '/' + a.headers['ratelimit-remaining']);
  const over = await call(port, 'GET', '/api/zz-no-such-route', A);
  ok(limited(over), 'person A call 6 is 429');
  ok(limited(await call(port, 'GET', '/api/zz-no-such-route', A2)), 'the same person on another session shares the one budget');
  const b = await call(port, 'GET', '/api/zz-no-such-route', B);
  ok(!limited(b), 'person B behind the same address still has a budget of their own');

  // 2 · the 429 carries the one problem shape and Retry-After, in shopkeeper words
  ok(/^application\/problem\+json/.test(over.headers['content-type'] || ''), '429 is problem+json');
  const body = JSON.parse(over.body);
  ok(body.code === 'RATE_LIMITED' && body.status === 429 && body.detail && body.hint && body.params.retry_after_seconds >= 1, '429 body: RATE_LIMITED, detail, hint, retry_after_seconds');
  ok(Number(over.headers['retry-after']) === body.params.retry_after_seconds, 'Retry-After header equals the body seconds');
  ok(over.headers['ratelimit-reset'] !== undefined, 'RateLimit-Reset on the 429');

  // 3 · a stranger is limited per address, at the stranger budget (3), and a signed-in budget never applies to them
  const results = []; for (let i = 0; i < 4; i++) results.push((await call(port, 'GET', '/api/zz-no-such-route', { authorization: 'Bearer not-a-real-token' })).status);
  ok(results.slice(0, 3).every((s) => s !== 429) && results[3] === 429, 'unsigned caller: 3 pass then 429 (' + results.join(',') + ')');

  // 4 · the per-address ceiling (12 for every caller together): 5+1+1+1+... already spent; keep going with fresh people until it refuses
  let sawCeiling = false;
  for (let i = 0; i < 20 && !sawCeiling; i++) {
    const r = await call(port, 'GET', '/api/zz-no-such-route', { authorization: 'Bearer ' + tokenFor('fresh-' + i, 'j' + i) });
    if (limited(r)) { sawCeiling = true; ok(JSON.parse(r.body).code === 'RATE_LIMITED' && Number(r.headers['retry-after']) >= 1, 'the address ceiling answers the same 429 with Retry-After (after ' + i + ' fresh people)'); }
  }
  ok(sawCeiling, 'the per-address ceiling refuses once everyone together passes it');
  // 5 · the sign-in limiters are as strict as before (defaults read from the real file; limit-settings.test.cjs drives the sign-in one for real)
  const src = require('fs').readFileSync(path.join(API, 'server.js'), 'utf8');
  ok(/intFromEnv\('AUTH_RATE_LIMIT_MAX', 30\)/.test(src) && /intFromEnv\('CHECK_LOGIN_RATE_LIMIT_MAX', 120\)/.test(src) && /intFromEnv\('CATALOGUE_RATE_LIMIT_MAX', 60\)/.test(src), 'sign-in 30, check-login 120, catalogue 60 per window: unchanged');
  srv.close();
  console.log('rate-limit-identity: ' + checks + ' checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
