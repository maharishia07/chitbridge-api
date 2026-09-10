/**
 * rewards.test.js — WHAT A REWARD POINT IS WORTH, AND WHAT A LEDGER MAY DO.
 *
 * Athi, 2026-09-10: *"how anyone knows the value of the rewards and its interpretation"* and *"build reward as a
 * capability so we can reuse it."*
 *
 * ⚠️ THIS TOUCHES MONEY. A points balance is a liability — money the shop owes — so the arithmetic is asserted
 * rather than eyeballed, and the REFUSALS are asserted as hard as the successes. A reward engine that fails open
 * gives stock away.
 *
 * Run: node tests/rewards.test.js   · no DB, no network.
 */
'use strict';
const assert = require('assert'), path = require('path');
const R = require(path.join(__dirname, '..', 'lib', 'rewards.js'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
                           catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— what a point is worth —');

const PROG = { name: 'Shop rewards', earn: { kind: 'per_amount', per: 100, points: 1 },
  redeem: [ { kind: 'money', points: 1, amount: 1 },
            { kind: 'item',  points: 500, name: '1 kg sugar' },
            { kind: 'thing', points: 20000, name: 'a weekend in Ooty for two' } ] };

it('⭐⭐ a balance is answered in WORDS, not as a bare number', () => {
  assert.strictEqual(R.worthOf(PROG, 450).says, '450 points · worth 450 off');
  assert.ok(R.worthOf(PROG, 600).says.indexOf('1 kg sugar') > 0, 'it does not say what the balance can actually buy');
});

it('⭐⭐ and it says how far the NEXT thing is — the half that makes a balance motivating', () => {
  const w = R.worthOf(PROG, 450);
  assert.strictEqual(w.next.name, '1 kg sugar');
  assert.strictEqual(w.next.short, 50, '"50 more points" is the reason to come back; "450 points" is not');
});

it('⚠️ a programme that declared no conversion says SO, and is never given a value', () => {
  const vague = { name: 'Points', earn: { kind: 'per_amount', per: 100, points: 1 }, redeem: [] };
  assert.ok(R.worthOf(vague, 450).says.indexOf('has not said what they are worth') > 0);
  assert.strictEqual(R.pointValue(vague), null, 'a worth was invented for a programme that declared none');
  assert.strictEqual(R.liability(vague, 450), null, 'null, not 0 — 0 would imply the shop owes nothing');
});

it('⚠️ the caller formats the money — a pure module has no currency', () => {
  const money = (n) => 'AED ' + n;
  assert.ok(R.worthOf(PROG, 450, { money }).says.indexOf('AED 450') > 0, 'ctx.money is ignored');
  assert.ok(R.describeEarn(PROG, { money }).indexOf('AED 100') > 0, 'the earn rule ignores ctx.money');
});

console.log('— what a basket earns —');

it('⭐ earned on the NET, and rounded DOWN', () => {
  assert.strictEqual(R.earnedOn(PROG, 2450), 24, '2,450 at 1 per 100 is 24 whole points, not 24.5 and not 25');
  assert.strictEqual(R.earnedOn(PROG, 99), 0, 'a bill below the rate earns nothing, and that is honest');
  /* ⚠️ rounding up would cost the shop a fraction of a point on every bill of the year */
  assert.strictEqual(R.earnedOn(PROG, 199), 1);
});

it('⚠️ nothing is earned from a programme that has not said how', () => {
  assert.strictEqual(R.earnedOn({ name: 'x' }, 5000), 0);
  assert.strictEqual(R.earnedOn(PROG, 0), 0);
  assert.strictEqual(R.earnedOn(PROG, -500), 0, 'a refund must never mint points');
});

console.log('— the mechanism is ours, the rule is the shop own —');

/**
 * ⭐⭐⭐ Athi, correcting the design: *"we don't need to specify the value conversion. We build the reward mechanism
 * and allow the business to decide … we can invent new."* So earning is a REGISTRY of kinds, the same shape
 * lib/offers-engine.js already uses, and adding a mechanism is a ROW rather than an edit to any caller.
 */
it('⭐⭐⭐ a business picks HOW points are earned, and each kind describes itself', () => {
  const basket = { net: 2450, gross: 2600, count: 7 };
  const on = (earn) => R.earnedOn({ name: 'p', earn }, basket);
  assert.strictEqual(on({ kind: 'per_amount', per: 100, points: 1 }), 24, 'n points per amount spent');
  assert.strictEqual(on({ kind: 'value_as_points', rate: 1 }), 2450, 'the sale value IS the points — Athi own example');
  assert.strictEqual(on({ kind: 'per_visit', points: 50 }), 50, 'rewarding the visit, not the spend');
  assert.strictEqual(on({ kind: 'per_item', points: 2 }), 14, 'rewarding volume, not value');
  /* every kind must be able to state itself — a rule nobody can read is a rule nobody trusts */
  for (const k of R.earnKinds) {
    const rule = { kind: k, per: 100, points: 1, rate: 1 };
    assert.ok(R.describeEarn({ earn: rule }, {}).length > 8, k + ' cannot say what it does');
  }
});

it('⚠️⚠️ an unknown or incomplete rule earns NOTHING and names the problem', () => {
  const basket = { net: 5000, count: 3 };
  assert.strictEqual(R.earnedOn({ earn: { kind: 'per_moon', points: 5 } }, basket), 0);
  assert.ok(R.describeEarn({ earn: { kind: 'per_moon' } }, {}).indexOf('no such earning rule') >= 0);
  /* ⚠️ a missing parameter is REFUSED, never defaulted — a guessed default mints points nobody agreed to give */
  assert.strictEqual(R.earnedOn({ earn: { kind: 'per_amount', points: 1 } }, basket), 0);
  assert.ok(R.describeEarn({ earn: { kind: 'per_amount', points: 1 } }, {}).indexOf('needs per') >= 0,
    'it must say WHICH parameter is missing');
  assert.strictEqual(R.earnCheck({ kind: 'per_amount', per: 100, points: 1 }).ok, true);
});

console.log('— the ledger —');

it('⭐⭐ a balance is the FOLD of what happened, never a stored number', () => {
  const led = [R.earn(PROG, 2450, 'C1/0001'), R.earn(PROG, 12000, 'C1/0002')];   /* 24 + 120 */
  const b = R.balanceOf(led);
  assert.strictEqual(b.points, 144);
  assert.strictEqual(b.earned, 144);
  assert.strictEqual(b.spent, 0);
  assert.strictEqual(b.entries, 2);
});

it('⭐ spending is an entry, and it carries the bill it was spent on', () => {
  const b = { points: 144 };
  const s = R.spend(b, 100, 'C1/0003');
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.entry.points, -100, 'a spend must be negative');
  assert.strictEqual(s.entry.why, 'spent');
  assert.strictEqual(s.entry.ref, 'C1/0003', 'a point spent against nothing cannot be traced');
});

it('⚠️⚠️ it REFUSES to spend more than is held', () => {
  const r = R.spend({ points: 44 }, 9999, 'x');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.entry, null, 'a refused spend must produce NO entry — an append-only ledger cannot take it back');
  assert.ok(r.why.indexOf('only 44') >= 0, 'the refusal must say what is available');
});

it('⚠️ and refuses nonsense: zero, negative, not a number', () => {
  for (const bad of [0, -5, null, undefined, 'lots', NaN])
    assert.strictEqual(R.spend({ points: 100 }, bad, 'x').ok, false, JSON.stringify(bad) + ' was accepted as a spend');
});

it('⚠️ an entry that cannot say WHY is not an entry', () => {
  assert.strictEqual(R.entry({ points: 5 }), null, 'an entry with no reason was accepted');
  assert.strictEqual(R.entry({ points: 0, why: 'earned' }), null, 'a zero entry records nothing');
  assert.strictEqual(R.entry({ points: 5, why: 'because' }), null, 'an unknown reason was accepted');
  assert.strictEqual(R.entry({ points: 5.7, why: 'earned' }).points, 5, 'points must be whole');
});

it('⚠️⚠️ a ledger that does not add up SAYS SO rather than clamping to zero', () => {
  const b = R.balanceOf([{ points: -50, why: 'spent' }]);
  assert.strictEqual(b.points, -50, 'it was silently clamped — the fault would be invisible');
  assert.strictEqual(b.negative, true, 'nothing flags a ledger a caller must refuse to trade on');
});

it('⭐ a correction is an ENTRY, not an edit — the reasons allow for it', () => {
  for (const why of ['earned', 'spent', 'adjusted', 'expired', 'reversed'])
    assert.ok(R.entry({ points: 1, why }), why + ' is not an allowed reason, so it could only be recorded by deleting');
});

console.log('— what the shop owes —');

it('⭐ the liability is stated plainly, at the money rate', () => {
  assert.strictEqual(R.liability(PROG, 48000), 48000, '48,000 points at ₹1 is ₹48,000 owed');
  assert.strictEqual(R.liability(PROG, 0), 0);
});

it('⭐ and the schema.org shape is emitted for a feed', () => {
  const s = R.schemaOrg(PROG);
  assert.strictEqual(s['@type'], 'MemberProgram');
  assert.strictEqual(s.hasTiers[0]['@type'], 'MemberProgramTier');
  assert.strictEqual(s.hasTiers[0].hasTierBenefit, 'https://schema.org/TierBenefitLoyaltyPoints');
  assert.strictEqual(R.schemaOrg(null), null, 'a programme with no name must not be published');
});

console.log(pass + ' checks');
