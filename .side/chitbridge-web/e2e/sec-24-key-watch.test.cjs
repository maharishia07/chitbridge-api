'use strict';
/* sec-24-key-watch.test.cjs — SEC-24: THE COUNTER CHECKS THAT ITS KEY WORKS, NOT ONLY THAT IT EXISTS (till keyWatch, TILL-170).
 * OWNS      the web half of SEC-24 ("ten bills were taken before anyone discovered they could not be sent"): public/till.html keyWatch() asks HOST.verify() at most once
 *           per KEY_EVERY_MS (ten minutes), is driven by the 15 s status timer, and calls a key REFUSED only on a 401 or 403 — a timeout, a 500 or a dropped line is
 *           recorded (cbQuiet) but never read as a bad key. A refusal shows "Due to maintenance" once, to the key holder. Runs the REAL keyWatch in a vm sandbox.
 *           (e2e/till-plain-signin.cjs covers refreshFailed on a 401; this covers the timer itself.)
 * CALLED BY .github/workflows/ci.yml (web guards) · e2e/sec-proofs.red.cjs (mutants)
 * FLOW      lift KEY_* vars + keyWatch from till.html → fake clock + HOST.verify answers → count verifies, flashes, cbQuiet records, KEY_OK
 * Run: node e2e/sec-24-key-watch.test.cjs */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const till = fs.readFileSync(path.join(__dirname, '..', 'public', 'till.html'), 'utf8');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const s = till.indexOf('var KEY_OK = true');
const f = till.indexOf('async function keyWatch(){', s);
const e = till.indexOf('\n}\n', f);
assert(s > 0 && f > s && e > f, 'keyWatch block not found in public/till.html');
const code = till.slice(s, e + 3);

function rig() {
  const clock = { t: 1000000 }, seen = { verify: 0, flash: [], quiet: [] };
  const cx = vm.createContext({
    console, Date: { now: () => clock.t }, Number, Error,
    HOST: { verify: () => { seen.verify++; return Promise.resolve(cx.ANSWER); }, key: 'k-1' },
    ANSWER: { ok: true }, LINE: true, lineUp: () => cx.LINE, personOn: () => false, STATE: {},
    flash: (ico, line) => seen.flash.push(line), keyWord: () => 'sign in again', pairAgain: () => {},
    cbQuiet: (where, err) => seen.quiet.push(where + ': ' + (err && err.message))
  });
  vm.runInContext(code, cx);
  return { cx, clock, seen, watch: () => vm.runInContext('keyWatch()', cx), keyOk: () => vm.runInContext('KEY_OK', cx) };
}

(async () => {
  ok(/var KEY_REFUSED_STATUSES = \[401, 403\]/.test(code) && /KEY_EVERY_MS = 600000/.test(code), 'the lifted block holds the ten-minute gate and the two refusal statuses');

  let r = rig();
  await r.watch();
  ok(r.seen.verify === 1, 'the first call asks the host to VERIFY the key (a check that it works, not that it exists)');
  await r.watch(); r.clock.t += 599000; await r.watch();
  ok(r.seen.verify === 1, 'asked again inside ten minutes: no second verify (once per 10 min)');
  r.clock.t += 2000; await r.watch();
  ok(r.seen.verify === 2, 'past ten minutes: it verifies again');

  for (const status of [401, 403]) {
    r = rig(); r.cx.ANSWER = { ok: false, status, why: 'refused' };
    await r.watch();
    ok(r.keyOk() === false && r.seen.flash.length === 1 && r.seen.flash[0] === 'Due to maintenance', 'a ' + status + ' = the key is refused: the counter says "Due to maintenance" once, KEY_OK false');
    r.clock.t += 700000; await r.watch();
    ok(r.seen.flash.length === 1, 'still refused ten minutes later: the flash is not repeated (no nagging)');
  }

  for (const bad of [{ ok: false, status: 500, why: 'server error' }, { ok: false, status: 502 }, { ok: false, why: 'ChitBridge did not answer in time' }, { ok: false, status: 404 }]) {
    r = rig(); r.cx.ANSWER = bad;
    await r.watch();
    ok(r.keyOk() === true && r.seen.flash.length === 0 && r.seen.quiet.length === 1, 'a ' + (bad.status || 'timeout') + ' says nothing about the key: no flash, KEY_OK stays true, and it is on the record (cbQuiet)');
  }

  r = rig(); r.cx.ANSWER = { ok: false, status: 401 }; await r.watch();
  r.cx.ANSWER = { ok: true }; r.clock.t += 700000; await r.watch();
  ok(r.keyOk() === true, 'a key that works again after a refusal clears KEY_OK');

  r = rig(); r.cx.LINE = false; await r.watch();
  ok(r.seen.verify === 0, 'no line, no verify (nothing to learn from a dead line)');
  r = rig(); r.cx.HOST = { key: 'k' }; await r.watch();
  ok(r.seen.verify === 0 && r.seen.flash.length === 0, 'a host with no verify() is skipped, never an error');
  r = rig(); r.cx.HOST = { verify: () => { r.seen.verify++; return Promise.reject(new Error('boom')); }, key: 'k' }; await r.watch();
  ok(r.keyOk() === true && r.seen.flash.length === 0 && r.seen.quiet.length === 1, 'a verify that throws is recorded, never a verdict');

  ok(/setInterval\(function\(\)\{ if \(!HOST\) return; HOST\.state\(\)[^\n]*keyWatch\(\);/.test(till), 'keyWatch is called from the 15 s status timer — the check runs by itself, not only when someone looks');
  ok(/KEY_ASKED = 0; await keyWatch\(\)/.test(till), 'the start-of-day step forces the same check past its gate (one question, one answer)');
  console.log('\n' + n + ' checks, all ok');
})().catch((err) => { console.error(err); process.exit(1); });
