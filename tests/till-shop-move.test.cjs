'use strict';
/**
 * till-shop-move.test.cjs — THE PERSON SIGNING IN WINS (Athi, 2026-10-09). Runs the page's OWN usignShopMove() and
 * shopMoveOf() text (sliced out of till.html, so a rewrite cannot drift from the test) against stubbed globals.
 * The rule: unknown on either side is never "keep the old shop".   Run: node tests/till-shop-move.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
function fn(sig) { const a = PAGE.indexOf(sig); assert.ok(a >= 0, sig + ' is gone'); return PAGE.slice(a, PAGE.indexOf('\n}\n', a) + 3); }
const src = fn('function shopMoveOf(') + fn('function usignShopMove(');
let pass = 0;
const it = (w, f) => { try { f(); pass++; console.log('  ok  ' + w); } catch (e) { console.log('  FAIL ' + w + '\n      ' + e.message); process.exitCode = 1; } };

/* a counter as the page would see it */
function move(c, theirs) {
  const g = Object.assign({ person: null, S: null, agent: false, paired: true, force: false, keyOk: true, marker: '' }, c);
  const run = new Function('personOn', 'CloudHost', 'S', 'onAgent', 'ls', 'shopLs', 'paired', 'USIGN', 'KEY_OK',
    src + '; return usignShopMove;')(
    () => !!(g.person && g.person.token), { person: g.person }, g.S, () => g.agent,
    { get: () => g.marker }, (k) => k, () => g.paired, { forceEnrol: g.force }, g.keyOk);
  return run(theirs === undefined ? null : { identity: theirs ? { entity_id: theirs } : {} });
}
const shopA = { entity_id: 'A' };

console.log('\nusignShopMove — decision table\n');
it('same shop (key opens A, person of A) -> same', () => assert.strictEqual(move({ S: shopA }, 'A'), 'same'));
it('staff of the same shop on a person session -> same', () => assert.strictEqual(move({ person: { token: 't', entity_id: 'A' } }, 'A'), 'same'));
it('other shop (key opens A, person of B) -> other', () => assert.strictEqual(move({ S: shopA }, 'B'), 'other'));
it('person session of A, person of B -> other', () => assert.strictEqual(move({ person: { token: 't', entity_id: 'A' } }, 'B'), 'other'));
it('UNKNOWN key-shop (snapshot not loaded, no marker) -> pair, never same', () => assert.strictEqual(move({ S: null }, 'B'), 'pair'));
it('unknown key-shop but the marker says A, person of B -> other', () => assert.strictEqual(move({ S: null, marker: 'A' }, 'B'), 'other'));
it('unknown key-shop but the marker says A, person of A -> same', () => assert.strictEqual(move({ S: null, marker: 'A' }, 'A'), 'same'));
it('UNKNOWN person-shop -> pair, never same', () => assert.strictEqual(move({ S: shopA }, ''), 'pair'));
it('no answer at all (nothing said) -> pair', () => assert.strictEqual(move({ S: shopA }, null), 'pair'));
it('person session of A, person of A, key refused or pairAgain -> still same (the session is replaced in place)', () => { assert.strictEqual(move({ person: { token: 't', entity_id: 'A' }, keyOk: false }, 'A'), 'same'); assert.strictEqual(move({ person: { token: 't', entity_id: 'A' }, force: true }, 'A'), 'same'); });
it('refused key (KEY_OK false) -> pair, even for the same shop', () => assert.strictEqual(move({ S: shopA, keyOk: false }, 'A'), 'pair'));
it('forceEnrol -> pair', () => assert.strictEqual(move({ S: shopA, force: true }, 'A'), 'pair'));
it('not paired -> pair', () => assert.strictEqual(move({ paired: false }, 'A'), 'pair'));
it('ids compare as text (7 vs "7")', () => assert.strictEqual(move({ S: { entity_id: 7 } }, '7'), 'same'));

console.log('\nthe page no longer offers to stay\n');
it('the other-shop step has no Stay option and no refusal', () => {
  const u = fn('async function usignIn(');
  assert.ok(!/'Stay '/.test(u) && !/This counter stays/.test(u), 'a Stay choice is back');
  assert.ok(/move !== 'same'/.test(u) && /usignBecome\(false\)/.test(u), 'a shop change no longer goes through usignBecome -> becomeShop');
});
it('a person not of this shop is not found in the counter PIN book', () => assert.ok(/e\.entity && S && S\.entity_id && String\(e\.entity\) !== String\(S\.entity_id\)\) return null/.test(PAGE)));
console.log('\n' + pass + ' passed');
