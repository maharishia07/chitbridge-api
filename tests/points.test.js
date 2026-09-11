/**
 * ── tests/points.test.js · A POINT CAN NEVER BE ADDED TO A RUPEE ─────────────────────────────────────────────
 *
 * Athi, 2026-09-11, looking at the engine expanded: *"write cases for points and jurisdiction."* Both are Tier A
 * pure rules; `points.js` had NO test naming it at all, and it is 140 lines whose entire job is to stop two
 * things being confused.
 *
 * ⚠️⚠️ A MANUAL CASE CANNOT COVER THIS. There is no screen on which a person can try to add a point to a rupee
 * and observe a refusal — the refusal happens in a type, before anything reaches a screen. This is exactly the
 * class the board marks `n/a` for manual, and it is why the only honest cover is a guard.
 *
 * ⭐⭐ THE RULE IT PROTECTS, IN ATHI'S OWN WORDS: *"encashing is a TENDER, not a discount"* (2026-09-09). A
 * discount would restate the taxable value of a bill and take the tax off twice. A tender is HOW you pay. So a
 * point must never enter an arithmetic that produces a total — and the guarding is done by SHAPE, not by a
 * symbol, because a symbol is a string and strings concatenate.
 *
 *     money   { amount: 3290, currency: 'INR' }
 *     points  { points: 500,  programme: 'Shop points' }
 *
 * ⚠️ AND THE HOLE THE FILE ITSELF DECLARES IS ASSERTED HERE TOO, as a KNOWN FAILURE rather than as a pass:
 * money.js still accepts { amount: 50, currency: 'PTS' } because 'PTS' matches its /^[A-Z]{3}$/. The file is
 * `@stage held` for that reason. A test that quietly skipped it would let the board show the reassuring half
 * green while the actual hole stayed open.
 *
 * Run: node tests/points.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert');
const P = require('../lib/points');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

console.log('— the shape is the guard —');

it('⭐⭐⭐ points and money are different SHAPES, and neither answers to the other', () => {
  const pts = P.make(500, 'Shop points');
  const money = { amount: 3290, currency: 'INR' };
  assert.deepStrictEqual(pts, { points: 500, programme: 'Shop points' });
  assert.ok(P.isPoints(pts), 'points must recognise its own value');
  assert.ok(!P.isPoints(money), 'money must NOT pass as points');
  assert.ok(!P.isMoneyShaped(pts), 'points must NOT pass as money');
  assert.ok(P.isMoneyShaped(money), 'money must be recognisable, so it can be refused by name');
});

it('⭐⭐ asking for the points of a MONEY value is refused, and says why', () => {
  /* ⚠️ A silent NaN here would be the whole bug: it would flow into a total and reach a bill. */
  assert.throws(() => P.pointsOf({ amount: 50, currency: 'INR' }), /money, not points/i,
    'money read as points must throw, not return a number');
  assert.throws(() => P.pointsOf(500), /Not a points value/,
    'a bare number is not points — it has no programme, so nobody knows whose it is');
  assert.strictEqual(P.pointsOf(P.make(7, 'X')), 7);
});

it('⚠️ the LOOSE reader still refuses money — it is lenient about form, never about type', () => {
  /* ⭐ pointsOfLoose exists for input that arrives as a string. Being lenient about `"500"` must not make it
     lenient about a rupee, which is a different kind of wrong. */
  assert.strictEqual(P.pointsOfLoose('500'), 500);
  assert.strictEqual(P.pointsOfLoose(500), 500);
  assert.ok(Number.isNaN(P.pointsOfLoose({ amount: 50, currency: 'INR' })), 'money must come back NaN');
  assert.ok(Number.isNaN(P.pointsOfLoose('')), 'blank is not zero');
  assert.ok(Number.isNaN(P.pointsOfLoose(null)));
});

console.log('— what a point must always carry —');

it('⭐ a point without a programme cannot be made — a shop may run more than one', () => {
  assert.throws(() => P.make(500), /name the programme/i);
  assert.throws(() => P.make(500, '   '), /name the programme/i);
  assert.strictEqual(P.make(500, '  Shop points  ').programme, 'Shop points', 'the name is trimmed');
});

it('⚠️ points are WHOLE, and a fraction is refused rather than rounded', () => {
  /**
   * ⭐ Rounding would be the friendly thing and the wrong thing: 0.5 of a point cannot be shown to a customer,
   * and every scheme in the world issues integers. A refusal at the type is a bug found where it started.
   */
  assert.throws(() => P.make(2.5, 'X'), /whole/i);
  assert.throws(() => P.make(NaN, 'X'), /finite/i);
  assert.throws(() => P.make(Infinity, 'X'), /finite/i);
  assert.strictEqual(P.make(-5, 'X').points, -5, 'negative is allowed — a reversal is a real event');
});

it('⚠️ a programme name has a ceiling, and it is stated rather than truncated', () => {
  const long = 'x'.repeat(P.NAME_MAX + 1);
  assert.throws(() => P.make(1, long), new RegExp(String(P.NAME_MAX)));
  assert.strictEqual(P.make(1, 'x'.repeat(P.NAME_MAX)).programme.length, P.NAME_MAX);
});

console.log('— adding up —');

it('⭐⭐⭐ TWO PROGRAMMES CANNOT BE ADDED, and that is the point of carrying the name', () => {
  /**
   * ⚠️ This is the same rule money.js applies to currencies, for the same reason: a total whose parts were
   * denominated differently is a number that means nothing, and it looks exactly like one that means something.
   */
  assert.throws(() => P.sum([P.make(5, 'Chola points'), P.make(5, 'Alpha points')]),
    /cannot be added/i, 'two programmes summed must throw');
  assert.deepStrictEqual(P.sum([P.make(5, 'A'), P.make(7, 'A')]), { points: 12, programme: 'A' });
});

it('⚠️ summing nothing is NULL, not zero', () => {
  /* ⭐ Zero is a balance somebody has; null is the absence of one. A screen that shows "0 points" to a customer
     who has never joined the programme has told them something untrue. */
  assert.strictEqual(P.sum([]), null);
  assert.strictEqual(P.sum(null), null);
  assert.strictEqual(P.sum([null, undefined]), null, 'a list of nothings is still nothing');
});

it('⚠️⚠️ money in a points sum is refused, not silently skipped', () => {
  assert.throws(() => P.sum([P.make(5, 'A'), { amount: 50, currency: 'INR' }]),
    /.+/, 'a rupee inside a points sum must stop the sum');
});

console.log('— how it reads —');

it('⭐ a formatted point names its programme and NEVER carries a currency symbol', () => {
  const out = P.format(P.make(1234, 'Shop points'));
  assert.ok(/1,234/.test(out), 'grouped for reading: ' + out);
  assert.ok(/Shop points/.test(out), 'the programme is named, or the number belongs to nobody: ' + out);
  assert.ok(!/[₹$€£¥]/.test(out), 'a currency symbol on points is the confusion this file exists to prevent');
});

console.log('— ⚠️ THE HOLE THIS FILE DECLARES, ASSERTED AS A KNOWN FAILURE —');

it('⚠️⚠️ money.js STILL accepts a PTS currency — the reason points.js is @stage held', () => {
  /**
   * ⭐⭐ THIS TEST PASSES WHILE THE PRODUCT IS WRONG, ON PURPOSE, and it is the most important one here.
   *
   * points.js says so in its own header: money.CODE_RE is /^[A-Z]{3}$/, so { amount: 50, currency: 'PTS' }
   * passes every check money makes and would be summed with rupees. The shape guard is only half a guard until
   * money REFUSES points-ish codes.
   *
   * ⚠️ Asserting the hole rather than skipping it means the day somebody closes it, THIS TEST FAILS and tells
   * them to finish the job — delete this case, and take the @stage held off points.js. A skipped test would
   * have said nothing on that day.
   */
  let money;
  try { money = require('../lib/money'); } catch (_) { return; }   /* absent here — nothing to assert */
  const fn = money.make || money.money || null;
  if (typeof fn !== 'function') return;
  let accepted = true;
  try { fn(50, 'PTS'); } catch (_) { accepted = false; }
  assert.strictEqual(accepted, true,
    '⭐ money.js now REFUSES PTS — the hole is closed. Delete this case and remove `@stage held` from '
    + 'lib/points.js, which is held open only for this.');
});

console.log('\n  ' + pass + ' checks\n');
