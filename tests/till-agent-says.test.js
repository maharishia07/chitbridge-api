'use strict';
/**
 * till-agent-says.test.js — THE DESKTOP COUNTER SAYS WHAT IS ACTUALLY WRONG ([TILL-117]).
 *
 * ── ⚠️⚠️⚠️ FOUND ON A REAL MACHINE, SETTING ONE UP ───────────────────────────────────────────────────────────
 *
 * Athi: *"i removed and again i was trying to run the start, i am not getting the shop in the desktop"* — and
 * the counter's own log said:
 *
 *     offline (GET /api/till/snapshot → 403 This key is not scoped for GET /api/till/snapshot)
 *
 * so he went looking at his network. The server had answered in a fifth of a second to say the key was the
 * wrong KIND — a connector key where a till key was needed. Nothing was offline.
 *
 * ⚠️⚠️ AND IT WAS NOT ONLY THE WORD. Both catch blocks set `online = false`, so a REFUSAL made the counter
 * believe it had no network: the status pill, /api/state and the queue all behaved as though the line were
 * down. A 403 arriving is proof that the line is UP.
 *
 * Run: node tests/till-agent-says.test.js   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.js'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/**
 * ⚠️ whyNot is a local of till.js, which is a program rather than a module — so it is lifted out and evaluated
 * on its own. Reading it out of the source is what keeps this test about the SHIPPED function rather than a
 * copy of it that could drift.
 */
function loadWhyNot() {
  const at = SRC.indexOf('function whyNot(e) {');
  assert.ok(at > 0, 'whyNot is gone from till.js — this guard is measuring nothing');
  const end = SRC.indexOf('\n}', at) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(SRC.slice(at, end) + '; return whyNot;')();
}
const whyNot = loadWhyNot();

console.log('— the counter says what is actually wrong —');

/**
 * ⚠️⚠️⚠️ THE ONE THAT SENT SOMEBODY TO CHECK THEIR ROUTER. A 401/403 means the server answered, so the line is
 * up and the counter must not mark itself offline.
 */
it('⚠️⚠️⚠️ a wrong key is not an outage', () => {
  for (const st of [401, 403]) {
    const w = whyNot({ status: st, message: 'GET /api/till/snapshot → ' + st + ' This key is not scoped' });
    assert.strictEqual(w.online, true, st + ' marked the counter offline — the server ANSWERED, so the line is up');
    assert.ok(!/offline/i.test(w.say), st + ' still says "offline": ' + w.say);
    /* ⭐ and it says what to DO — a person reading a log at 7am needs the next step, not a diagnosis */
    assert.ok(/scope/i.test(w.say) && /till/.test(w.say), st + ' does not name the fix: ' + w.say);
    /* ⚠️ a wrong key never comes right by waiting, so the caller is told not to retry in silence */
    assert.strictEqual(w.fatal, true, st + ' is treated as something retrying will fix');
  }
});

it('⭐ another refusal is reported as a refusal, and the line still counts as up', () => {
  const w = whyNot({ status: 409, message: 'POST /api/till/close → 409 already closed' });
  assert.strictEqual(w.online, true);
  assert.ok(/refused/i.test(w.say), w.say);
  assert.strictEqual(w.fatal, false, 'a 409 is not a credential problem and must not stop the queue for ever');
});

it('⭐ ChitBridge having trouble is not the shop\'s fault, and not its line', () => {
  const w = whyNot({ status: 503, message: 'GET /api/till/snapshot → 503' });
  assert.strictEqual(w.online, true, 'a 503 arrived, so the line is up');
  assert.ok(/trouble/i.test(w.say) && !/offline/i.test(w.say), w.say);
});

/**
 * ⚠️⚠️ AND THE CASES THAT REALLY ARE THE LINE STILL SAY SO. Over-correcting would be the same bug in reverse:
 * a counter that never admits it is offline is as unhelpful as one that always claims to be.
 */
it('⚠️⚠️ a timeout and a dead line still report as offline', () => {
  const t = whyNot({ timeout: true, message: 'GET /api/till/snapshot → no answer in 120s' });
  assert.strictEqual(t.online, false, 'a timeout was treated as though the server had answered');
  assert.ok(/no answer/i.test(t.say), t.say);

  const dead = whyNot(new Error('fetch failed'));
  assert.strictEqual(dead.online, false, 'nothing came back and the counter still thinks it is online');
  assert.ok(/offline/i.test(dead.say), 'a genuinely dead line no longer says offline: ' + dead.say);
  assert.ok(/billing continues/i.test(dead.say), 'it no longer reassures that billing continues: ' + dead.say);
});

it('⭐ and it never throws on whatever it is handed', () => {
  for (const bad of [null, undefined, {}, 'a string', new Error('')])
    assert.doesNotThrow(() => whyNot(bad));
});

/**
 * ⚠️⚠️ STARTING IT TWICE IS NOT A FAULT. `node index.js install` registers a task that fires every five
 * minutes whenever the counter is not running — and when it IS running, that path used to throw an unhandled
 * EADDRINUSE and print a stack trace at a shopkeeper who had done nothing wrong.
 */
it('⚠️⚠️ a second copy says the first one is fine, and exits 0', () => {
  const at = SRC.indexOf("server.on('error'");
  assert.ok(at > 0, 'the listen error is unhandled again — a second start prints a stack trace');
  const body = SRC.slice(at, SRC.indexOf('});', at));
  assert.ok(/EADDRINUSE/.test(body), 'the already-running case is no longer recognised');
  assert.ok(/already running/i.test(body), 'it no longer says the counter is already up');
  assert.ok(/exit\(0\)/.test(body), 'it exits non-zero — Task Scheduler would report a fault every five minutes');
  /**
   * ⚠️⚠️⚠️ AND IT RETURNS. process.exit(0) used to end the handler by itself; deferring it (to let an in-flight
   * request settle, which otherwise trips a libuv assertion on Windows) left the code FALLING THROUGH to
   * "could not start" and exit(1) — the friendly sentence printed, and then the crash anyway.
   */
  /* ⚠️⚠️ STRIP THE COMMENTS FIRST. The note explaining this very fix CONTAINS the words "could not start",
     so slicing the raw source ended the branch before the return it was checking for — the guard read the
     explanation as the code. The same trap lib/categories set, and scripts/dbfree records. */
  const code = body.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const branch = code.slice(code.indexOf('EADDRINUSE'), code.indexOf('could not start'));
  assert.ok(/\breturn;/.test(branch),
    'the already-running branch does not return — it falls through to the failure path it was written to avoid');
});

console.log(pass + ' checks');
