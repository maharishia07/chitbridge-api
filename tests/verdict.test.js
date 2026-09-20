'use strict';
/**
 * verdict.test.js — ONE CAUSE, ONE SENTENCE, ONE BUTTON.
 *
 * Athi: *"are we giving the consistent message everywhere?"* — after one counter, with one cause, told him four
 * different stories at once: the footer said "10 waiting" (patience), 🩺 said "Paired key: NO" (wrong — the
 * program was paired), 🩺 four lines later said "the counter program still has 10 to send" (contradicting
 * itself), and the log said "mint a key with scope till" (advice that could not work: it was CLOSED).
 *
 * Every one of those was assembled where it was shown. This is the guard on the single home.
 *
 * Run: node tests/verdict.test.js   · no DB, no network.
 */
const assert = require('assert');
const V = require('../lib/verdict');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** a healthy counter, which each case then spoils in exactly one way */
const well = { paired: true, scopes: ['till'], items: 12, online: true, queued: 0, till: 'C1' };

console.log('\nEVERY VERDICT ANSWERS THE THREE QUESTIONS\n');

/**
 * ⚠️⚠️ THE SHAPE IS THE CONTRACT. A view that has to ask "is there a fix for this one?" is a view that will
 * eventually answer it differently from its neighbour.
 */
it('every verdict has a line, a why, and says whether anything is lost', () => {
  for (const v of V.VERDICTS) {
    assert.ok(v.line && v.line.length > 8, v.code + ' has no line');
    assert.ok(v.why && v.why.length > 12, v.code + ' does not say what it means');
    assert.strictEqual(typeof v.lost, 'boolean', v.code + ' does not say whether anything is lost');
  }
});

it('anything that is NOT ok carries a fix and an action', () => {
  for (const v of V.VERDICTS) {
    if (v.ok) continue;
    assert.ok(v.fix, v.code + ' is a fault with no fix');
    assert.ok(v.act, v.code + ' offers a fix with no button behind it');
  }
});

/** ⚠️ the healthy ones must NOT offer a button — a fix for nothing teaches people to press things */
it('and the healthy ones offer none', () => {
  for (const v of V.VERDICTS) if (v.ok) { assert.ok(!v.fix, v.code + ' offers a fix while healthy'); }
});

console.log('\nTHE CAUSES, WORST FIRST\n');

it('no key at all', () => {
  const v = V.read({ paired: false, queued: 10 });
  assert.strictEqual(v.code, 'NOT_PAIRED');
  assert.strictEqual(v.act, 'signinOpen');
  assert.strictEqual(v.lost, false);
});

/** ⚠️⚠️ the one the design did not have, and the one that actually happened on 2026-09-20 */
it('TAKEN BY ANOTHER DEVICE says so, and warns what taking it back costs', () => {
  const v = V.read(Object.assign({}, well, { queued: 10, queue_fatal: true, queue_code: 'COUNTER_CLOSED' }));
  assert.strictEqual(v.code, 'COUNTER_CLOSED');
  assert.ok(/opened somewhere else/i.test(v.line), v.line);
  assert.ok(/C1/.test(v.why), 'it does not name the counter: ' + v.why);
  assert.ok(/other device will stop/i.test(v.why), 'it does not warn what taking it back does: ' + v.why);
  assert.strictEqual(v.act, 'signinOpen');
});

it('a key of the wrong kind', () => {
  const v = V.read(Object.assign({}, well, { scopes: ['connector'] }));
  assert.strictEqual(v.code, 'WRONG_SCOPE');
  assert.ok(!/scope/i.test(v.line), 'the LINE leaks a technical word: ' + v.line);
});

it('paired but no catalogue', () => {
  assert.strictEqual(V.read(Object.assign({}, well, { items: 0 })).code, 'NO_SHOP_COPY');
});

it('offline with things waiting', () => {
  const v = V.read(Object.assign({}, well, { online: false, queued: 4 }));
  assert.strictEqual(v.code, 'OFFLINE');
  assert.ok(/goes by itself/i.test(v.why), 'it does not reassure: ' + v.why);
});

it('a fatal refusal that is not one of the named ones', () => {
  assert.strictEqual(V.read(Object.assign({}, well, { queued: 3, queue_fatal: true })).code, 'SHOP_REFUSING');
});

it('simply sending', () => {
  const v = V.read(Object.assign({}, well, { queued: 3 }));
  assert.strictEqual(v.code, 'SENDING');
  assert.strictEqual(v.ok, true);
});

it('and a quiet counter is boring on purpose', () => {
  const v = V.read(well);
  assert.strictEqual(v.code, 'ALL_SENT');
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.fix, null);
});

console.log('\n⚠️⚠️ ONLY ONE VERDICT MAY SAY WORK IS AT RISK\n');

/**
 * ⚠️ The spec is explicit: only storage full (and a damaged database) ever say work is at risk. Every other
 * fault must say the opposite, because "nothing is lost" is the most important line on the page when it is true.
 */
it('storage full is the one that says work is at risk', () => {
  const v = V.read(Object.assign({}, well, { storage_bad: true, queued: 2 }));
  assert.strictEqual(v.code, 'STORAGE_FULL');
  assert.strictEqual(v.lost, true);
  assert.ok(/can lose work/i.test(v.why), v.why);
});

it('and NOTHING else does', () => {
  const risky = V.VERDICTS.filter((x) => x.lost).map((x) => x.code);
  assert.deepStrictEqual(risky, ['STORAGE_FULL'],
    'more than one verdict claims work is at risk: ' + risky.join(', '));
});

console.log('\n⚠️ THE TECHNICAL ACCOUNT NEVER REACHES THE SELLING SCREEN\n');

/**
 * ⚠️⚠️ Athi: *"no technical details are required — keep it in diagnosis."* The server's own sentence is carried
 * on `detail` for 🩺 and must never appear in the line a shopkeeper reads.
 */
it('the server sentence rides on detail, and only there', () => {
  const said = 'This counter was closed on 2026-09-20. Open a new counter from ChitBridge to bill again.';
  const v = V.read(Object.assign({}, well, { queued: 10, queue_fatal: true, queue_code: 'COUNTER_CLOSED', queue_say: said }));
  assert.strictEqual(v.detail, said, 'the diagnosis lost the server’s own words');
  assert.ok(v.line.indexOf(said) < 0, 'the LINE is quoting the server at a shopkeeper');
  assert.ok(v.why.indexOf(said) < 0, 'the WHY is quoting the server at a shopkeeper');
});

it('no line anywhere leaks a status code, a URL or a header name', () => {
  for (const v of V.VERDICTS) {
    const txt = v.line + ' ' + v.why;
    assert.ok(!/\b40[0-9]\b|\b50[0-9]\b/.test(txt), v.code + ' prints a status code: ' + txt);
    assert.ok(!/https?:\/\//.test(txt), v.code + ' prints a URL');
    assert.ok(!/api[_ ]?key|jti|token|X-Api/i.test(txt), v.code + ' names a credential');
  }
});

console.log('\nTHE SUPPORT CODE\n');

it('the same problem gives the same code every time', () => {
  const a = V.read({ paired: false, till: 'C1' }).support;
  const b = V.read({ paired: false, till: 'C1' }).support;
  assert.strictEqual(a, b);
});

it('a different problem, or a different counter, gives a different one', () => {
  const a = V.read({ paired: false, till: 'C1' }).support;
  const b = V.read({ paired: true, scopes: ['till'], items: 0, till: 'C1' }).support;
  const c = V.read({ paired: false, till: 'C2' }).support;
  assert.notStrictEqual(a, b, 'two causes share a code');
  assert.notStrictEqual(a, c, 'two counters share a code');
});

it('and it carries nothing about the shop', () => {
  const v = V.read({ paired: false, till: 'C1', shop: 'Mayur Bhavan' });
  assert.ok(/^T[0-9A-Z-]+$/.test(v.support), 'the support code is not a plain code: ' + v.support);
});

it('nothing thrown on an empty reading', () => {
  assert.ok(V.read().code);
  assert.ok(V.read({}).code);
});

console.log('\n' + pass + ' checks passed\n');
