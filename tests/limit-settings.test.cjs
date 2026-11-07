'use strict';
/**
 * SEC-125 · A TYPO IN A NUMERIC SETTING FAILS CLOSED. Every limit setting goes through lib/limits.intFromEnv: unset, empty, a typo ("abc", "30s"),
 * a negative, a decimal, a huge number all give the SAFE DEFAULT (never NaN or 0, which express-rate-limit and the deadline read as "no limit");
 * only a whole number inside the range is taken. Each case here states its EFFECTIVE limit: the reader's answer AND the count of calls a real
 * limiter lets through before the 429. The REAL server.js is loaded in a child for the sign-in limiter (the OTP/PIN brute-force door).
 *
 * Run: node tests/limit-settings.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const express = require('express');
const API = path.join(__dirname, '..');
process.env.LOG_LEVEL = 'error'; /* the once-only warning is counted through the logger spy below, not printed */
const limits = require(path.join(API, 'lib', 'limits'));
const log = require(path.join(API, 'lib', 'logger'));
const { rateLimit } = require(path.join(API, 'lib', 'rate-limit'));

let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); console.log('  ok  ' + m); };

/** [setting value, expected effective limit, why]; the default under test is 30 */
const CASES = [
  [undefined, 30, 'unset'],
  ['', 30, 'empty'],
  ['   ', 30, 'blank'],
  ['abc', 30, 'typo: letters'],
  ['30s', 30, 'typo: a unit on the number'],
  ['-5', 30, 'negative'],
  ['0', 30, 'zero (a limiter of 0 reads as off)'],
  ['2.5', 30, 'decimal'],
  ['1e9', 30, 'exponent form'],
  ['NaN', 30, 'the word NaN'],
  ['99999999999999999999', 30, 'huge: past the safe integers'],
  ['100000001', 30, 'huge: past the ceiling'],
  ['7', 7, 'valid'],
  [' 12 ', 12, 'valid with spaces'],
  ['100000000', 100000000, 'valid: the ceiling itself (sim-load asks for 10 million)']
];

/** how many calls pass before the first 429 on a limiter built with this max (probe is capped: a huge limit is probed, not exhausted) */
async function callsAllowed(max, probe) {
  const app = express();
  app.use(rateLimit({ windowMs: 60000, max, standardHeaders: false, legacyHeaders: false }));
  app.get('/x', (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  let passed = 0;
  for (let i = 0; i < probe; i++) {
    const status = await new Promise((r) => http.get({ port, path: '/x' }, (res) => { res.resume(); r(res.statusCode); }));
    if (status === 429) break;
    passed++;
  }
  server.close();
  return passed;
}

async function readerCases() {
  const warned = [];
  const realWarn = log.warn;
  log.warn = (msg) => warned.push(msg);
  for (const [value, want, why] of CASES) {
    if (value === undefined) delete process.env.SEC125_X; else process.env.SEC125_X = value;
    const got = limits.intFromEnv('SEC125_X', 30);
    ok(got === want, why + ' (' + JSON.stringify(value) + ') -> effective limit ' + want + ' (got ' + got + ')');
    const calls = await callsAllowed(got, 40);
    ok(calls === Math.min(want, 40), why + ': a real limiter lets ' + Math.min(want, 40) + ' calls through before 429 (got ' + calls + ')');
  }
  const refused = CASES.filter((c) => c[1] === 30 && c[0] !== undefined).length;
  ok(warned.length === refused, 'every refused value is logged (' + warned.length + ' lines for ' + refused + ' refused cases)');
  process.env.SEC125_X = 'abc';
  limits.intFromEnv('SEC125_X', 30);
  ok(warned.length === refused, 'the same refused value is not logged twice');
  log.warn = realWarn;
  delete process.env.SEC125_X;
}

function timeoutCases() {
  const run = (name, fn, value, want, why) => {
    process.env[name] = value;
    const got = fn();
    ok(got === want, name + ' ' + why + ' -> ' + want + ' (got ' + got + ')');
    delete process.env[name];
  };
  run('REQUEST_TIMEOUT_MS', limits.requestTimeoutMs, '', 30000, 'empty (was 0 = deadline OFF)');
  run('REQUEST_TIMEOUT_MS', limits.requestTimeoutMs, 'abc', 30000, 'typo');
  run('REQUEST_TIMEOUT_MS', limits.requestTimeoutMs, '-1', 30000, 'negative');
  run('REQUEST_TIMEOUT_MS', limits.requestTimeoutMs, '0', 0, 'explicit 0 stays the documented off');
  run('REQUEST_TIMEOUT_MS', limits.requestTimeoutMs, '5000', 5000, 'valid');
  run('DB_STATEMENT_TIMEOUT_MS', limits.statementTimeoutMs, '', 15000, 'empty (was 0 = deadline OFF)');
  run('DB_STATEMENT_TIMEOUT_MS', limits.statementTimeoutMs, '1.5s', 15000, 'typo');
  run('DB_STATEMENT_TIMEOUT_MS', limits.statementTimeoutMs, '2000', 2000, 'valid');
}

/** the REAL server.js with a setting for the sign-in limit: how many sign-in calls pass before the 429 (default 30) */
function realServerCase(value, want) {
  const script = `
    const path = require('path'); const http = require('http');
    const { stubDatabase, loadApp } = require(path.join(${JSON.stringify(API)}, 'tools', 'load-app.cjs'));
    stubDatabase(); const app = loadApp();
    const server = http.createServer(app);
    server.listen(0, async () => {
      const port = server.address().port; let passed = 0;
      for (let i = 0; i < 40; i++) {
        const status = await new Promise((r) => { const q = http.request({ port, path: '/api/signin/ask', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); r(res.statusCode); }); q.end('{}'); });
        if (status === 429) break; passed++;
      }
      console.log('PASSED=' + passed); process.exit(0);
    });`;
  const env = Object.assign({}, process.env, { LOG_LEVEL: 'error', NODE_ENV: 'test' });
  env.AUTH_RATE_LIMIT_MAX = value;
  const out = cp.spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 60000, cwd: API });
  const m = /PASSED=(\d+)/.exec(out.stdout || '');
  ok(m && Number(m[1]) === want, 'real server.js, AUTH_RATE_LIMIT_MAX=' + JSON.stringify(value) + ' -> ' + want + ' sign-in calls then 429 (got ' + (m ? m[1] : 'no answer: ' + (out.stderr || '').slice(0, 200)) + ')');
}

function sourceCases() {
  const bad = [];
  for (const f of ['server.js', 'routes/products.js']) {
    fs.readFileSync(path.join(API, f), 'utf8').split('\n').forEach((line, i) => { if (/parseInt\(process\.env/.test(line)) bad.push(f + ':' + (i + 1)); });
  }
  ok(bad.length === 0, 'no limiter reads parseInt(process.env...) any more (' + bad.join(', ') + ')');
  const idem = fs.readFileSync(path.join(API, 'middleware', 'idempotency.js'), 'utf8');
  ok(!/Number\(process\.env\.IDEMPOTENCY_/.test(idem), 'idempotency reads its window hours, stale minutes and token minutes through intFromEnv');
  process.env.IDEMPOTENCY_WINDOW_HOURS = '48h';
  ok(limits.intFromEnv('IDEMPOTENCY_WINDOW_HOURS', 48) === 48, 'IDEMPOTENCY_WINDOW_HOURS typo -> 48 hours (a replay window, not NaN)');
  delete process.env.IDEMPOTENCY_WINDOW_HOURS;
}

(async () => {
  await readerCases();
  timeoutCases();
  sourceCases();
  realServerCase('abc', 30);
  realServerCase('', 30);
  realServerCase('3', 3);
  console.log(checks + ' checks passed');
})().catch((e) => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(1); });
