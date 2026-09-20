'use strict';
/**
 * counter-claim.test.js — ONE COUNTER, ONE HOLDER ([TILL-138]).
 *
 * ── ⚠️⚠️⚠️ WHAT THIS DEFENDS ────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, after his browser silently took C1 from a counter that was mid-day: *"without knock of this counter, the
 * other one should not open?"* — and then, the sharper question: *"will it overlap the sequence number?"*
 *
 * It would have. The bill series is per counter id, and the server only learns where a run stopped because the
 * counter TELLS it (`issued` rides the snapshot call). A released counter is being 401'd, so it tells the server
 * nothing — `resume_next` stays null and a second device on C1 starts at 0001 as well. Two PCs both C1 is
 * already on record as the root cause of "sent but not in Task".
 *
 * The registry always refused a second holder. `POST /api/till/enrol` walked around it by minting a key and
 * registering nothing, which is how a counter came to be billing while the shop believed C1 was free.
 *
 * ── ⚠️ THESE READ THE SOURCE, AND SAY SO ────────────────────────────────────────────────────────────────────
 *
 * claim() runs inside a live transaction over a table this machine has no copy of. Loading it to call it would
 * mean stubbing the database, the key mint AND the auth middleware — three stubs whose agreement with
 * production nobody checks, and a stub that refuses nothing while passing is worse than an honest source check.
 * What caused the fault was a missing REFUSAL and a missing REGISTRATION, and both are visible in the text.
 *
 * Run: node tests/counter-claim.test.js   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

const API = path.join(__dirname, '..');
const COUNTERS = fs.readFileSync(path.join(API, 'routes', 'counters.js'), 'utf8');
const TILL = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** the body of the one shared claim */
const CLAIM = (function () {
  const at = COUNTERS.indexOf('router.claim = async');
  assert.ok(at > 0, 'counters.claim is gone — this guard is measuring nothing');
  const end = COUNTERS.indexOf('module.exports', at);
  return COUNTERS.slice(at, end > 0 ? end : COUNTERS.length);
})();

console.log('\nONE COUNTER, ONE HOLDER\n');

it('claiming refuses a counter somebody else is holding', () => {
  assert.ok(/!takeover &&/.test(CLAIM), 'refusing is no longer the default');
  assert.ok(/status: 409/.test(CLAIM), 'a held counter no longer answers 409');
  assert.ok(/COUNTER_HELD/.test(CLAIM), 'the refusal no longer carries a code the counter can act on');
});

it('and the refusal says WHO has it, so a dead PC can be told from a busy one', () => {
  assert.ok(/held_by/.test(CLAIM), 'it does not name the holder');
  assert.ok(/seen/.test(CLAIM), 'it does not say when that device was last seen');
});

/**
 * ⚠️⚠️ THE ORDER IS THE PROPERTY. A gap between releasing the old holder and claiming for the new one is a
 * window in which two keys both believe they hold C1 — which is exactly how two runs of bill numbers start.
 */
it('a takeover releases the holder BEFORE it claims, in one transaction', () => {
  const release = CLAIM.indexOf('closed_at');
  const claim = CLAIM.indexOf('patchCounter(db, entity_id, want');
  assert.ok(release > 0, 'a takeover no longer closes the previous key');
  assert.ok(claim > 0, 'the claim no longer records the new holder');
  assert.ok(release < claim, 'the release happens after the claim — two keys would hold one counter');
});

it('and the released key stops working at once', () => {
  assert.ok(/forgetKey/.test(CLAIM),
    'the released key is left in the auth cache, so it would keep billing for up to a minute');
});

it('the new key is told which counter it is, and where the run stopped', () => {
  assert.ok(/counter: want/.test(CLAIM), 'the key does not record its counter');
  assert.ok(/issued: Number\(got\.counter\.next\) > 1/.test(CLAIM),
    'the key does not carry whether that counter has already issued numbers — the series could restart');
});

console.log('\n⚠️⚠️ ENROL USES THE SAME DOOR\n');

it('enrol claims, and never mints on its own', () => {
  const at = TILL.indexOf("router.post('/enrol'");
  assert.ok(at > 0, 'the enrol route is gone');
  const body = TILL.slice(at, TILL.indexOf('\n});', at));
  assert.ok(/counters\.claim\(/.test(body), 'enrol mints without claiming — the registry is bypassed again');
  assert.ok(!/keys\.mint\(/.test(body), 'enrol still mints its own key');
  assert.ok(/claimed\.status !== 200/.test(body), 'enrol does not relay the refusal');
});

it('and it only takes a counter when asked in words', () => {
  const at = TILL.indexOf("router.post('/enrol'");
  const body = TILL.slice(at, TILL.indexOf('\n});', at));
  assert.ok(/takeover: !!\(req\.body && req\.body\.takeover\)/.test(body),
    'enrol can take a held counter without being told to');
});

it('the reply says which counter, and whether it took it from somebody', () => {
  assert.ok(/counter: claimed\.counter/.test(TILL), 'the reply does not say which counter');
  assert.ok(/took_over: !!claimed\.released/.test(TILL), 'the reply does not say it took it');
});

console.log('\n⚠️ THE COUNTER ASKS BEFORE IT TAKES\n');

it('the screen names the holder and what taking it costs them', () => {
  assert.ok(/is already open on/.test(PAGE), 'the counter does not say who has it');
  assert.ok(/stops that device from sending/.test(PAGE), 'it does not say what taking it does to the other device');
  assert.ok(/nothing is lost either way/.test(PAGE), 'it does not say no sale is lost');
  assert.ok(/till-signin-takeover/.test(PAGE), 'there is no control to take it');
});

/** ⚠️ the destructive choice is never the one a tired person presses by reflex */
it('and taking it is the quiet button — leaving it alone is the default', () => {
  const at = PAGE.indexOf('till-signin-takeover');
  const near = PAGE.slice(Math.max(0, at - 500), at);
  assert.ok(/class="pri" onclick="signinClose\(\)/.test(near),
    'the primary button is not "leave it alone" — the destructive choice is the default');
});

it('it explains WHY two counters cannot share a number', () => {
  assert.ok(/same numbers/.test(PAGE),
    'the screen does not say that two counters on one number produce colliding bill numbers');
});

console.log('\n' + pass + ' checks passed\n');
