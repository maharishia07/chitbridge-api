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
  ok(warned.length === 1, 'a refused setting is logged ONCE, whatever the values (' + warned.length + ' line)');
  ok(/SEC125_X/.test(warned[0]) && !/abc|30s|99999/.test(warned[0]), 'the line names the setting and carries no value');
  log.warn = realWarn;
  delete process.env.SEC125_X;
}

/** a secret pasted into the wrong setting must never reach a log line (name only) */
function secretCases() {
  const lines = [];
  const realWarn = log.warn;
  log.warn = (msg, ctx) => lines.push(JSON.stringify([msg, ctx]));
  const secret = 'sk-live-SUPERSECRET-9f8e7d';
  ['SEC125_S1', 'SEC125_S2'].forEach((name, i) => { process.env[name] = i ? secret + ' ' : secret; limits.intFromEnv(name, 5); limits.numFromEnv(name, 5); });
  log.warn = realWarn;
  ok(lines.length === 2 && lines.every((l) => !l.includes('SUPERSECRET')), 'a secret-looking value never appears in the log (' + lines.length + ' lines, name only)');
  delete process.env.SEC125_S1; delete process.env.SEC125_S2;
}

/** numFromEnv: decimals are taken inside the range; typo, blank, negative, exponent, huge fall back */
function decimalCases() {
  const cases = [[undefined, 25], ['', 25], ['abc', 25], ['-1', 25], ['1e3', 25], ['NaN', 25], ['2.5.1', 25], ['Infinity', 25], ['99999999999', 25], ['0', 0], ['1.5', 1.5], [' 40 ', 40]];
  for (const [value, want] of cases) {
    if (value === undefined) delete process.env.SEC125_D; else process.env.SEC125_D = value;
    const got = limits.numFromEnv('SEC125_D', 25, { min: 0 });
    ok(got === want, 'numFromEnv ' + JSON.stringify(value) + ' -> ' + want + ' (got ' + got + ')');
  }
  process.env.SEC125_D = '150';
  ok(limits.numFromEnv('SEC125_D', 40, { max: 100 }) === 40, 'numFromEnv past its max (a percent of 150) -> the default');
  delete process.env.SEC125_D;
}

/** every converted site: file, setting, default, reader, bounds. Source must call the reader with exactly these, and the reader must give typo/blank -> default, valid -> valid. */
const SITES = [
  ['routes/till.js', 'TILL_CATALOGUE_MAX', 20, 'int', {}], ['lib/otp.js', 'MAX_OTP_ATTEMPTS', 5, 'int', {}],
  ['lib/ai.js', 'AI_PRICE_IN', 1, 'num', { min: 0 }], ['lib/ai.js', 'AI_PRICE_OUT', 5, 'num', { min: 0 }], ['lib/kyb.js', 'KYB_FIELD_COST_USD', 0.02, 'num', { min: 0 }],
  ['lib/ai.js', 'AI_MAX_TOKENS', 4000, 'int', {}], ['lib/ai.js', 'AI_MAX_IMAGES', 4, 'int', {}], ['lib/ai.js', 'AI_MAX_IMAGE_B64', 1400000, 'int', {}],
  ['lib/ai.js', 'AI_FREE_USD', 1.0, 'num', { min: 0 }], ['lib/ai.js', 'AI_RATE_PER_HOUR', 60, 'int', {}], ['lib/ai.js', 'AI_RATE_PER_DAY', 300, 'int', {}],
  ['lib/ai.js', 'AI_GLOBAL_DAILY_USD', 25, 'num', { min: 0 }], ['lib/ai.js', 'AI_METER_FAIL_MAX', 20, 'int', {}], ['lib/ai.js', 'AI_SKILL_TTL_MS', 60000, 'int', { min: 0 }],
  ['lib/speech.js', 'SPEECH_TIMEOUT_MS', 20000, 'int', {}], ['lib/whatsapp-media.js', 'WHATSAPP_MEDIA_MAX_BYTES', 5000000, 'int', {}],
  ['lib/workpattern.js', 'WORKPATTERN_MEMO_TTL_MS', 300000, 'int', { min: 0 }],
  ['lib/retention.js', 'RETENTION_GRACE_DAYS', 30, 'int', { min: 0 }], ['lib/retention.js', 'RETENTION_SOFT_DELETE_DAYS', 7, 'int', { min: 0 }],
  ['lib/retention.js', 'RETENTION_MAX_EXTEND_DAYS', 365, 'int', { min: 0 }], ['lib/retention.js', 'RETENTION_MAX_ROWS_PER_RUN', 1000, 'int', {}],
  ['lib/retention.js', 'RETENTION_MAX_PCT_PER_RUN', 20, 'int', { max: 100 }],
  ['lib/kyb.js', 'KYB_EXPIRY_WINDOW_DAYS', 60, 'int', {}], ['lib/kyb.js', 'KYB_CONCENTRATION_PCT', 40, 'num', { max: 100 }], ['lib/kyb.js', 'KYB_FIELD_CACHE_HOURS', 24, 'int', { min: 0 }]
];
function siteCases() {
  for (const [file, name, def, kind, bounds] of SITES) {
    const src = fs.readFileSync(path.join(API, file), 'utf8');
    const call = (kind === 'int' ? 'intFromEnv' : 'numFromEnv') + "('" + name + "', ";
    ok(src.includes(call) && !new RegExp('(Number|parseInt)[(]process[.]env[.]' + name).test(src), file + ' reads ' + name + ' through ' + call.split('(')[0]);
    const read = kind === 'int' ? limits.intFromEnv : limits.numFromEnv;
    const valid = Math.min(bounds.max === undefined ? 7 : bounds.max, 7);
    for (const [value, want, why] of [['abc', def, 'typo'], ['', def, 'blank'], [String(valid), valid, 'valid']]) {
      process.env[name] = value;
      const got = read(name, def, bounds);
      ok(got === want, name + ' ' + why + ' ' + JSON.stringify(value) + ' -> ' + want + ' (got ' + got + ')');
    }
    delete process.env[name];
  }
}

/** MAX_OTP_ATTEMPTS: NaN used to mean unlimited tries; a typo must still lock after 5 wrong codes (real lib/otp.js in a child) */
function otpCases() {
  const script = "const o = require('./lib/otp'); (async () => { const at = (n) => o.verifyOtp(async () => ({}), { otp_attempts: n, otp_code: '123456' }, '000000', {}); const r4 = await at(0), r5 = await at(5); console.log('CAP=' + o.MAX_OTP_ATTEMPTS + ' AT0=' + r4.reason + ' AT5=' + r5.reason); })().catch((e) => { console.log('ERR=' + e.message); });";
  for (const [value, cap] of [['abc', 5], ['', 5], ['-1', 5], ['3', 3]]) {
    const out = cp.spawnSync(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { LOG_LEVEL: 'error', MAX_OTP_ATTEMPTS: value }), encoding: 'utf8', cwd: API, timeout: 60000 });
    const m = /CAP=([0-9]+) AT0=([A-Z_]+) AT5=([A-Z_]+)/.exec(out.stdout || '');
    ok(m && Number(m[1]) === cap && m[3] === 'OTP_LOCKED' && m[2] === "OTP_WRONG", 'MAX_OTP_ATTEMPTS=' + JSON.stringify(value) + ' -> cap ' + cap + ', locked at 5 wrong tries (' + (m ? m[0] : (out.stdout + out.stderr).slice(0, 150)) + ')');
  }
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
  secretCases();
  decimalCases();
  siteCases();
  otpCases();
  timeoutCases();
  sourceCases();
  realServerCase('abc', 30);
  realServerCase('', 30);
  realServerCase('3', 3);
  console.log(checks + ' checks passed');
})().catch((e) => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(1); });
