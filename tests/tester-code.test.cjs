/**
 * tests/tester-code.test.cjs — SEC1 (Athi, 2026-10-14: "do the alternate arrangements, do not keep the code in the logic, i can share
 * the password to the testers"). The tester sign-in code is env TESTER_CODE, checked on the VERIFY side (lib/otp.js verifyOtp →
 * lib/dev-otp.js testerCodeOk); the fixed codes work on a LOCAL stack only. Proves:
 *   · TESTER_CODE set → it signs in (any name); a wrong code is refused and counted like any wrong code; unset or < 8 → nothing works
 *   · the fixed codes are refused on a non-local DATABASE_URL (and with NODE_ENV " development"), accepted on a local one
 *   · TESTER_NAMES allows the listed names / patterns and refuses the rest
 *   · the code never appears in a log line or an answer, and a refusal looks the same whether a tester code exists or not
 *   · the compare is crypto.timingSafeEqual over SHA-256 digests · no file that ships names a fixed code outside dev-otp's LOCAL block
 *   · SEC1b (TEMPORARY): {yymmdd}/{yyyymmdd} in TESTER_CODE fills with today in IST on the shop clock; yesterday's until 06:00; one
 *     placeholder; ≥ 8 after filling; the boot says TEMPORARY at warn and nothing else — never the template or the code
 * Run: node tests/tester-code.test.cjs · no network, no DB.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const out = process.stdout.write.bind(process.stdout);
const t = (name, ok, extra) => { if (ok) { pass++; out('  ok  ' + name + '\n'); } else { fail++; out('  FAIL ' + name + (extra ? '\n       ' + extra : '') + '\n'); } };

const SECRET = 'tq7-Lantern-42';
const LOCAL = 'postgres://cb@127.0.0.1:5432/cb_test', REMOTE = 'postgres://cb:pw@db.example-host.supabase.co:5432/postgres';
const KEYS = ['TESTER_CODE', 'TESTER_NAMES', 'TESTER_CODE_TZ', 'SHOP_CLOCK_ALLOW', 'DEV_OTP', 'DEV_OTP_CUSTOMER', 'DEV_OTP_CONNECTOR', 'DEV_OTP_IN_RESPONSE', 'NODE_ENV', 'DATABASE_URL'];
function env(vars) { KEYS.forEach((k) => { delete process.env[k]; }); Object.assign(process.env, vars || {}); }
function load() {
  ['../lib/dev-otp', '../lib/otp', '../lib/logger'].forEach((m) => { try { delete require.cache[require.resolve(m)]; } catch (_) { /* not loaded yet */ } });
  return { dev: require('../lib/dev-otp'), otp: require('../lib/otp') };
}
/** a stand-in `run` — records the attempt counter the way identities would */
const fakeRun = (row) => async (sql) => { if (/otp_attempts = COALESCE/.test(sql)) row.otp_attempts = (row.otp_attempts || 0) + 1; return { rows: [] }; };
const rowOf = (extra) => Object.assign({ identity_id: 'i1', email: 'owner@shop.test', user_id: 'mayuri123', bridge_id: 'B-1',
  otp_code: '402917', otp_expires_at: new Date(Date.now() + 3600e3), otp_attempts: 0 }, extra || {});

/* every byte the process writes — console, the logger, stdout, stderr — while a block runs */
async function captured(fn) {
  const buf = [];
  const ow = process.stdout.write, ew = process.stderr.write, saved = {};
  ['log', 'warn', 'error', 'info', 'debug'].forEach((k) => { saved[k] = console[k]; console[k] = (...a) => buf.push(a.map(String).join(' ')); });
  process.stdout.write = (s) => { buf.push(String(s)); return true; };
  process.stderr.write = (s) => { buf.push(String(s)); return true; };
  let result;
  try { result = await fn(); } finally { process.stdout.write = ow; process.stderr.write = ew; Object.assign(console, saved); }
  return { result, text: buf.join('\n') };
}

(async () => {
  out('\nSEC1 · the tester code is Athi\'s secret, never in the code\n');

  /* ── 1 · TESTER_CODE signs in; a wrong code is refused ─────────────────────────────────────────────────────────────── */
  env({ NODE_ENV: ' development', DATABASE_URL: REMOTE, DEV_OTP: '1', TESTER_CODE: SECRET, TESTER_NAMES: '*' });
  let { dev, otp } = load();
  let row = rowOf();
  t('TESTER_CODE set → the tester code signs in (stored code untouched)', (await otp.verifyOtp(fakeRun(row), row, SECRET)).ok === true);
  t('…with any sign-in name and no code ever issued', (await otp.verifyOtp(fakeRun(row), rowOf({ otp_code: null, email: 'anyone@x.test' }), SECRET)).ok === true);
  row = rowOf();
  const wrong = await otp.verifyOtp(fakeRun(row), row, SECRET + 'x');
  t('a wrong code is refused (400 OTP_WRONG) and counted', wrong.ok === false && wrong.status === 400 && wrong.reason === 'OTP_WRONG' && row.otp_attempts === 1);
  t('a locked account stays locked even for the tester code', (await otp.verifyOtp(fakeRun(row), rowOf({ otp_attempts: 5 }), SECRET)).status === 429);
  env({ NODE_ENV: ' development', DATABASE_URL: REMOTE, DEV_OTP: '1' }); ({ dev, otp } = load());
  t('TESTER_CODE unset → no tester code works', dev.testerCodeOk(SECRET) === false && (await otp.verifyOtp(fakeRun(rowOf()), rowOf(), SECRET)).ok === false);
  env({ TESTER_CODE: '1234567' }); ({ dev } = load());
  t('TESTER_CODE shorter than 8 → refused', dev.testerCodeOk('1234567') === false);

  /* ── 2 · the fixed codes: refused on a non-local database, accepted on a local one ───────────────────────────────── */
  const fixed = require('../lib/dev-otp').DEFAULTS;   // the LOCAL STACK block — never a literal here
  for (const [label, vars] of [
    ['production as it runs (NODE_ENV " development", remote DB)', { NODE_ENV: ' development', DATABASE_URL: REMOTE, DEV_OTP: '1' }],
    ['a docker / remote host with NODE_ENV=development', { NODE_ENV: 'development', DATABASE_URL: 'postgres://cb@db:5432/cb', DEV_OTP: '1' }],
    ['a local DB but NODE_ENV=test', { NODE_ENV: 'test', DATABASE_URL: LOCAL, DEV_OTP: '1' }],
    ['no DATABASE_URL at all', { NODE_ENV: 'development', DEV_OTP: '1' }],
  ]) {
    env(vars); ({ dev, otp } = load());
    const issued = otp.generateOTP();
    const tries = await Promise.all(Object.values(fixed).map((c) => otp.verifyOtp(fakeRun(rowOf({ otp_code: issued })), rowOf({ otp_code: issued }), c)));
    t('fixed codes refused — ' + label, dev.fixedOtp('entity') === null && dev.fixedOtp('customer') === null && dev.fixedOtp('connector') === null
      && !Object.values(fixed).includes(issued) && tries.every((x) => x.ok === false) && dev.mayExposeOtp() === false);
  }
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    env({ NODE_ENV: ' Development ', DATABASE_URL: 'postgres://cb@' + host + ':5432/cb', DEV_OTP: '1' }); ({ dev, otp } = load());
    const issued = otp.generateOTP();
    t('fixed codes accepted on a LOCAL stack (' + host + ')', dev.isLocalStack() && dev.fixedOtp('entity') === fixed.entity && dev.fixedOtp('customer') === fixed.customer
      && issued === fixed.entity && (await otp.verifyOtp(fakeRun(rowOf({ otp_code: issued })), rowOf({ otp_code: issued }), fixed.entity)).ok === true);
  }

  /* ── 3 · TESTER_NAMES ──────────────────────────────────────────────────────────────────────────────────────────────── */
  env({ TESTER_CODE: SECRET, TESTER_NAMES: '*@test.chitbridge, anil-tester' }); ({ dev, otp } = load());
  t('TESTER_NAMES allows a pattern match', dev.testerCodeOk(SECRET, ['ravi@test.chitbridge']) === true);
  t('TESTER_NAMES allows an exact name (any case)', dev.testerCodeOk(SECRET, ['Anil-Tester']) === true);
  t('TESTER_NAMES refuses a name not on it', dev.testerCodeOk(SECRET, ['owner@shop.test', 'mayuri123']) === false);
  t('…a pattern is not a substring match', dev.testerCodeOk(SECRET, ['x@test.chitbridge.evil.com']) === false);
  t('…verifyOtp checks the typed name and the identity\'s own names', (await otp.verifyOtp(fakeRun(rowOf()), rowOf(), SECRET, { names: ['ravi@test.chitbridge'] })).ok === true
    && (await otp.verifyOtp(fakeRun(rowOf()), rowOf({ email: 'qa@test.chitbridge' }), SECRET)).ok === true
    && (await otp.verifyOtp(fakeRun(rowOf()), rowOf(), SECRET, { names: ['someone@else.test'] })).ok === false);

  /* ── 3b · W1 · the Build preview strip (dev_tools on GET /entities/me) — an explicit list only ─────────────────────── */
  env({ TESTER_CODE: SECRET, TESTER_NAMES: '*@test.chitbridge, anil-tester' }); ({ dev } = load());
  t('dev tools: a name on an explicit TESTER_NAMES list sees them', dev.mayShowDevTools(['ravi@test.chitbridge']) === true);
  t('dev tools: a shop not on the list does not', dev.mayShowDevTools(['owner@shop.test', 'mayuri123', 'B-1']) === false);
  env({ TESTER_CODE: SECRET }); ({ dev } = load());
  t('dev tools: an EMPTY TESTER_NAMES (code open to all) shows them to nobody', dev.mayShowDevTools(['ravi@test.chitbridge']) === false);
  env({ TESTER_CODE: SECRET, TESTER_NAMES: '*' }); ({ dev } = load());
  t('dev tools: TESTER_NAMES * shows them to nobody', dev.mayShowDevTools(['ravi@test.chitbridge']) === false);
  env({ NODE_ENV: 'development', DATABASE_URL: LOCAL }); ({ dev } = load());
  t('dev tools: the local stack always shows them', dev.mayShowDevTools([]) === true);
  const meRoute = fs.readFileSync(require('path').join(__dirname, '..', 'routes', 'entities.js'), 'utf8');
  t('GET /entities/me carries dev_tools from mayShowDevTools', meRoute.includes('dev_tools: devOtp.mayShowDevTools('));

  /* ── 4 · never logged, never answered, never revealed ─────────────────────────────────────────────────────────────── */
  env({ NODE_ENV: ' development', DATABASE_URL: REMOTE, TESTER_CODE: SECRET, TESTER_NAMES: 'only-me', LOG_LEVEL: 'debug' }); ({ dev, otp } = load());
  const cap = await captured(async () => {
    const answers = [];
    answers.push(await otp.verifyOtp(fakeRun(rowOf()), rowOf(), SECRET, { names: ['only-me'] }));
    answers.push(await otp.verifyOtp(fakeRun(rowOf()), rowOf(), SECRET, { names: ['not-me'] }));
    answers.push(await otp.verifyOtp(fakeRun(rowOf()), rowOf(), SECRET.slice(0, -1)));
    answers.push(otp.generateOTP());
    require('../lib/logger').info('sign-in', { id: 'req-1' });
    return answers;
  });
  t('the tester code is in no log line (console, logger, stdout, stderr)', !cap.text.includes(SECRET), cap.text.slice(0, 200));
  t('the tester code is in no answer', !JSON.stringify(cap.result).includes(SECRET));
  const refusedWith = JSON.stringify(cap.result[1]);
  env({ NODE_ENV: ' development', DATABASE_URL: REMOTE }); ({ otp } = load());
  const refusedWithout = JSON.stringify(await otp.verifyOtp(fakeRun(rowOf()), rowOf(), SECRET, { names: ['not-me'] }));
  t('a refusal is the same answer whether or not a tester code exists', refusedWith === refusedWithout, refusedWith + ' vs ' + refusedWithout);

  /* ── 5 · the compare, the one door, the literals ──────────────────────────────────────────────────────────────────── */
  const src = fs.readFileSync(path.join(API, 'lib', 'dev-otp.js'), 'utf8');
  const fn = src.slice(src.indexOf('function testerCodeOk'), src.indexOf('\n}\n', src.indexOf('function testerCodeOk')));
  t('testerCodeOk compares with crypto.timingSafeEqual over SHA-256 digests', /timingSafeEqual\(digest\(got\), digest\(want\)\)/.test(fn)
    && /createHash\('sha256'\)/.test(src) && !/===\s*want|want\s*===/.test(fn));
  t('verifyOtp asks testerCodeOk (the one verify every door uses)', /testerCodeOk\(code, names\)/.test(fs.readFileSync(path.join(API, 'lib', 'otp.js'), 'utf8')));

  /* what ships: lib · routes · middleware · db · server.js · public · docs (minus the LOCAL-STACK docs) · .env.example.
     scripts/, tests/, tools/ and migrations/ run against a local stack (or are history) — they may name the local codes. */
  const LOCAL_DOCS = new Set(['docs/SIM-LOAD.md', 'docs/critique/SEC1.md']);
  const files = [];
  const walk = (rel) => { const abs = path.join(API, rel); if (!fs.existsSync(abs)) return; const st = fs.statSync(abs);
    if (st.isDirectory()) { for (const f of fs.readdirSync(abs)) if (f !== 'node_modules') walk(rel + '/' + f); }
    else if (/\.(c?js|html|md|json|ya?ml)$/.test(rel) || rel.endsWith('.env.example')) files.push(rel); };
  ['lib', 'routes', 'middleware', 'db', 'public', 'docs'].forEach(walk); files.push('server.js', '.env.example');
  const lit = new RegExp('(^|[^0-9.])(' + Object.values(fixed).join('|') + ')(?![0-9])');
  const hits = [];
  for (const rel of files) {
    if (LOCAL_DOCS.has(rel)) continue;
    let text = fs.readFileSync(path.join(API, rel), 'utf8');
    if (rel === 'lib/dev-otp.js') {   // the LOCAL STACK block is the one place allowed
      const a = text.indexOf('// ── LOCAL STACK ONLY'), b = text.indexOf('// ── end LOCAL STACK ──');
      t('dev-otp.js keeps its fixed codes inside a marked LOCAL STACK block', a > 0 && b > a);
      text = text.slice(0, a) + text.slice(b);
    }
    text.split('\n').forEach((line, i) => { if (lit.test(line) && !/money\(|\d\.\d|sample/i.test(line)) hits.push(rel + ':' + (i + 1)); });
  }
  t('guard: no fixed test code outside dev-otp.js\'s LOCAL STACK block in anything that ships (' + files.length + ' files)', hits.length === 0, hits.slice(0, 8).join(' · '));
  const envReaders = files.filter((rel) => rel !== 'lib/dev-otp.js' && /\.c?js$/.test(rel) && /process\.env\.TESTER_(CODE|NAMES)/.test(fs.readFileSync(path.join(API, rel), 'utf8')));
  t('one door: only lib/dev-otp.js reads TESTER_CODE / TESTER_NAMES', envReaders.length === 0, envReaders.join(' · '));

  /* ── 6 · SEC1b · the daily code (TEMPORARY) — a fixed shop clock, IST ──────────────────────────────────────────────── */
  const clock = require('../lib/shop-clock');
  env({}); await captured(async () => {   // the day rule lives in books-hooks, which brings the db pool; let its no-database boot line pass here, unasserted
    require('../lib/books-hooks'); await require('../db').query('select 1').catch(() => { /* no database in this test, by design */ });
  });
  const at = (ist) => clock.set(ist + '+05:30');
  env({ SHOP_CLOCK_ALLOW: '1', TESTER_NAMES: '*', TESTER_CODE: 'qa-{yymmdd}-lamp' }); ({ dev } = load());
  at('2026-10-14T10:00:00');
  t('{yymmdd} → 261014 on 14 Oct IST', dev.testerCodeOk('qa-261014-lamp', ['qa']) === true && dev.testerCodeOk('qa-{yymmdd}-lamp', ['qa']) === false);
  t('…yesterday\'s code refused after 06:00', dev.testerCodeOk('qa-261013-lamp', ['qa']) === false);
  at('2026-10-14T05:59:59');
  t('…yesterday\'s code accepted before 06:00 (and today\'s too)', dev.testerCodeOk('qa-261013-lamp', ['qa']) === true && dev.testerCodeOk('qa-261014-lamp', ['qa']) === true);
  t('…the day before yesterday never', dev.testerCodeOk('qa-261012-lamp', ['qa']) === false);
  at('2026-10-14T06:00:00');
  t('…refused from 06:00 sharp', dev.testerCodeOk('qa-261013-lamp', ['qa']) === false && dev.testerCodeOk('qa-261014-lamp', ['qa']) === true);
  clock.set('2026-10-13T19:00:00Z');   // 00:30 on 14 Oct in India, still the 13th in UTC
  t('the day is India\'s, not the server\'s UTC', dev.testerCodeOk('qa-261014-lamp', ['qa']) === true);
  env({ SHOP_CLOCK_ALLOW: '1', TESTER_NAMES: '*', TESTER_CODE: 'qa-{yymmdd}-lamp', TESTER_CODE_TZ: 'Australia/Sydney' }); ({ dev } = load());
  clock.set('2026-10-14T15:00:00Z');   // 02:00 on 15 Oct in Sydney
  t('TESTER_CODE_TZ overrides the zone', dev.testerCodeOk('qa-261015-lamp', ['qa']) === true && dev.testerCodeOk('qa-261014-lamp', ['qa']) === true);
  env({ SHOP_CLOCK_ALLOW: '1', TESTER_NAMES: '*', TESTER_CODE: 'Q{yyyymmdd}' }); ({ dev } = load());
  at('2026-10-14T10:00:00');
  t('{yyyymmdd} → 20261014', dev.testerCodeOk('Q20261014', ['qa']) === true && dev.testerCodeOk('Q261014', ['qa']) === false);
  env({ SHOP_CLOCK_ALLOW: '1', TESTER_NAMES: '*', TESTER_CODE: SECRET }); ({ dev } = load());
  at('2026-10-14T03:00:00');
  t('a static code is unchanged by the clock', dev.testerCodeOk(SECRET, ['qa']) === true && dev.testerCodeOk(SECRET + '261014') === false);
  env({ SHOP_CLOCK_ALLOW: '1', TESTER_NAMES: '*', TESTER_CODE: 'a{yymmdd}' }); ({ dev } = load());
  t('too short after filling (7) → no tester code works', dev.testerCodeOk('a261014', ['qa']) === false
    && dev.testerNotices().some((n) => /shorter than 8/.test(n.reason)));
  env({ SHOP_CLOCK_ALLOW: '1', TESTER_NAMES: '*', TESTER_CODE: 'qa-{yymmdd}{yymmdd}' }); ({ dev } = load());
  t('two placeholders → refused', dev.testerCodeOk('qa-261014261014', ['qa']) === false && dev.testerNotices().some((n) => /more than one/.test(n.reason)));

  env({ SHOP_CLOCK_ALLOW: '1', TESTER_NAMES: '*', TESTER_CODE: 'qa-{yymmdd}-lamp', LOG_LEVEL: 'debug' }); ({ dev, otp } = load());
  at('2026-10-14T05:00:00');
  const daily = await captured(async () => {
    const log = require('../lib/logger');
    dev.testerNotices().forEach((n) => log[n.level](n.msg, { reason: n.reason }));   // exactly what server.js does at boot
    dev.testerCodeOk('qa-261014-lamp', ['qa']); dev.testerCodeOk('qa-261013-lamp', ['qa']); dev.testerCodeOk('nope-nope-nope', ['qa']);
    await otp.verifyOtp(fakeRun(rowOf()), rowOf(), 'qa-261014-lamp');
  });
  const lines = daily.text.split('\n').filter((l) => l.trim());
  t('nothing logged but the TEMPORARY warning and the explicit-* warning (warn level)', lines.length === 2 && /TEMPORARY: a tester sign-in code is active \(testing phase\)\. Remove TESTER_CODE before real users\./.test(lines[0])
    && /TESTER_NAMES is \*/.test(lines[1]) && lines.every((l) => /"level":"warn"/i.test(l)), lines.join(' | ').slice(0, 300));
  t('…and never the template or an expansion', !/\{yymmdd\}|qa-|261014|261013/.test(daily.text));
  env({}); ({ dev } = load());
  t('TESTER_CODE unset → no boot notice', dev.testerNotices().length === 0);
  clock.reset();
  t('server.js logs testerNotices at boot', /testerNotices\(\)\.forEach/.test(fs.readFileSync(path.join(API, 'server.js'), 'utf8')));
  for (const doc of ['docs/HOSTING.md', 'docs/DEPLOY-RUNBOOK.md', 'docs/DEV-DEPLOY-CHECKLIST.md']) {
    const d = fs.readFileSync(path.join(API, doc), 'utf8');
    t(doc + ' has the "Before real users — REMOVE" item for TESTER_CODE · TESTER_NAMES · E2E_TESTER_CODE',
      /Before real users — REMOVE/.test(d) && /TESTER_CODE/.test(d) && /TESTER_NAMES/.test(d) && /E2E_TESTER_CODE/.test(d));
  }

  out('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { out('crashed: ' + (e && e.stack) + '\n'); process.exit(1); });
