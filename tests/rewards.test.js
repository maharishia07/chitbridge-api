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

/**
 * ⭐⭐⭐ Athi: *"it should be exactly like offer — for some item, instead of discount you add reward, so the reward
 * can be encashed during next visit, so a repeated customer can be invented."* Same trigger, same product scope,
 * different economics: a discount is spent today; points are a promise the customer must come back to collect.
 */
it('⭐⭐⭐ a reward can be given on chosen products, instead of a discount', () => {
  const basket = { net: 1200, count: 5, lines: [
    { item_id: 'a', sku: 'SH-1', qty: 2, categories: ['Personal care'] },
    { item_id: 'b', sku: 'RC-1', qty: 3, categories: ['Rice & grains'] } ] };
  const on = (earn, ctx) => R.earnedOn({ name: 'p', earn }, basket, ctx);
  assert.strictEqual(on({ kind: 'on_items', points: 200, applies_to: { category: 'Personal care' } }), 400,
    'two units at 200 points each');
  assert.strictEqual(on({ kind: 'on_items', points: 200, per: 'line', applies_to: { category: 'Personal care' } }), 200,
    'per line, not per unit');
  assert.strictEqual(on({ kind: 'on_items', points: 50, applies_to: { skus: ['RC-1'] } }), 150, 'scoped by sku');
  assert.strictEqual(on({ kind: 'on_items', points: 99, applies_to: { category: 'Cleaning' } }), 0,
    'nothing in the basket qualifies, so nothing is earned');
  /* it states itself in the shop's own words */
  assert.ok(R.describeEarn({ earn: { kind: 'on_items', points: 200, applies_to: { category: 'Personal care' } } }, {})
    .indexOf('200 points on Personal care') === 0);
});

it('⚠️⚠️ the OFFERS ENGINE is the matcher when the caller offers one', () => {
  const basket = { net: 100, count: 1, lines: [{ item_id: 'a', qty: 1, categories: ['Personal care'] }] };
  const earn = { kind: 'on_items', points: 200, applies_to: { category: 'Personal care' } };
  assert.strictEqual(R.earnedOn({ earn }, basket), 200, 'the fallback matcher should find it');
  /* ⚠️ a line that does not say HOW MANY earns nothing rather than being assumed to be one — points are minted
     from a quantity, and assuming one on a malformed line is minting a liability out of a missing field. */
  assert.strictEqual(R.earnedOn({ earn }, { net: 100, lines: [{ item_id: 'a', categories: ['Personal care'] }] }), 0,
    'a line with no quantity minted points');
  assert.strictEqual(R.earnedOn({ earn }, basket, { matches: () => false }), 0,
    'ctx.matches must win — two matchers would eventually disagree, and a shelf would promise what a bill refused');
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

console.log('— what the bill says —');

/**
 * ⭐⭐ Athi: *"reward point can be showcased in the bill, similarly when we adjust next time the reward conversion
 * should be showcased as well — say reward points added, and reward point encashed."*
 * ⚠️ THE TWO ARE NOT THE SAME KIND OF THING. Added is a promise and changes no total; encashed is money off today
 * and MUST be inside it. A bill that presented them alike would not foot — and that is the error a customer finds
 * first, at the counter, holding the paper.
 */
it('⭐⭐ points EARNED are a note; points ENCASHED are money', () => {
  const money = (n) => 'Rs' + Math.abs(n).toFixed(2);
  const b = R.billSays(PROG, { added: 24, spent: 100, balance: 548 }, { money });
  const byWhere = (w) => b.lines.filter((l) => l.where === w);
  assert.strictEqual(byWhere('money').length, 1, 'the encashment must be one money line');
  assert.strictEqual(byWhere('money')[0].amount, -100, '100 points at Re 1 each is 100 off');
  assert.strictEqual(b.money, 100);
  const note = byWhere('note')[0];
  assert.strictEqual(note.amount, null, 'earned points must carry NO amount — a figure invites a subtraction');
  assert.ok(note.label.indexOf('earned: 24') > 0);
});

it('⭐ and it says where they now stand, which is the reason to come back', () => {
  const b = R.billSays(PROG, { added: 24, balance: 450 }, {});
  const last = b.lines[b.lines.length - 1];
  assert.ok(last.label.indexOf('Your points') === 0);
  assert.ok(last.label.indexOf('50 more for 1 kg sugar') > 0, 'the next reward is the whole argument for a reward');
});

it('⚠️ a bill with nothing to say about rewards says nothing', () => {
  assert.strictEqual(R.billSays(PROG, {}, {}).lines.length, 0, 'an empty reward block was printed on every bill');
  /* ⚠️ and points cannot be encashed for money the programme never priced */
  const noRate = { name: 'x', redeem: [{ kind: 'item', points: 500, name: 'sugar' }] };
  assert.strictEqual(R.billSays(noRate, { spent: 500 }, {}).money, 0,
    'points were turned into money by a programme that declared no money rate');
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

console.log('— who holds the points —');

it('⭐ a registered customer holds them against their id', () => {
  assert.deepStrictEqual(R.holderOf({ identity_id: 'cust-9' }), { scheme: 'identity', value: 'cust-9' });
  assert.deepStrictEqual(R.holderOf({ customer_identity_id: 'cust-9' }), { scheme: 'identity', value: 'cust-9' });
});

it('⭐ a walk-in holds them against the phone number they gave', () => {
  assert.deepStrictEqual(R.holderOf({ phone: '98400 12345' }), { scheme: 'phone', value: '9840012345' });
  assert.deepStrictEqual(R.holderOf({ phone: '+91 98400 12345' }), { scheme: 'phone', value: '+919840012345' },
    'the country code is part of the number and must survive');
});

it('⚠️ a walk-in who gave nothing holds nothing — earning is skipped, not accrued to nobody', () => {
  assert.strictEqual(R.holderOf({ name: 'Walk-in' }), null);
  assert.strictEqual(R.holderOf(null), null);
  assert.strictEqual(R.holderOf({ phone: '984' }), null, 'a three-digit number is a typo, not a customer');
});

it('⚠️ the id wins over the phone — one person must not hold two balances', () => {
  assert.deepStrictEqual(R.holderOf({ identity_id: 'cust-9', phone: '9840012345' }),
    { scheme: 'identity', value: 'cust-9' });
});

it('⭐ and a holder has one key, so a row and a lookup cannot disagree', () => {
  assert.strictEqual(R.holderKey({ scheme: 'phone', value: '9840012345' }), 'phone:9840012345');
  assert.strictEqual(R.holderKey(null), null);
});

console.log('— when points run out —');

it('⭐ expiry is declared, and a shop that says nothing expires nothing', () => {
  const led = [R.entry({ points: 100, why: 'earned', at: '2025-01-01T00:00:00.000Z' })];
  assert.strictEqual(R.expired({ earn: PROG.earn }, led).length, 0,
    'a balance was expired by a shop that never declared an expiry');
  assert.strictEqual(R.expiresAt({ earn: PROG.earn }, '2025-01-01T00:00:00.000Z'), null);
});

it('⭐ twelve months from the day they were earned', () => {
  assert.strictEqual(String(R.expiresAt({ expires_months: 12 }, '2025-01-15T00:00:00.000Z')).slice(0, 10),
    '2026-01-15');
});

it('⭐⭐ expiry is a LEDGER ENTRY, not a filter — the customer can see what went', () => {
  const old = '2024-01-01T00:00:00.000Z';
  const led = [R.entry({ points: 100, why: 'earned', at: old }),
               R.entry({ points: 40,  why: 'earned', at: new Date().toISOString() })];
  const gone = R.expired({ expires_months: 12 }, led);
  assert.strictEqual(gone.length, 1, 'only the old earning has expired');
  assert.strictEqual(gone[0].points, -100);
  assert.strictEqual(gone[0].why, 'expired');
  assert.strictEqual(R.balanceOf(led.concat(gone)).points, 40);
});

it('⚠️ only earnings expire — a spend must never be expired back into existence', () => {
  const old = '2024-01-01T00:00:00.000Z';
  const led = [R.entry({ points: 100, why: 'earned', at: old }),
               R.entry({ points: -30, why: 'spent',  at: old })];
  const gone = R.expired({ expires_months: 12 }, led);
  assert.strictEqual(gone.length, 1);
  assert.ok(gone.every((e) => e.points < 0), 'expiry wrote a positive entry');
});

console.log('— the walk-in who registers —');

it('⭐⭐ a phone balance is claimed onto the account as two entries that net to zero', () => {
  const from = { scheme: 'phone', value: '9840012345' }, to = { scheme: 'identity', value: 'cust-9' };
  const c = R.claim({ points: 340 }, from, to, 'CLAIM-1');
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.entries.length, 2);
  assert.strictEqual(c.entries.reduce((a, e) => a + e.points, 0), 0, 'a claim minted or destroyed points');
  assert.deepStrictEqual(c.entries[0].holder, from);
  assert.deepStrictEqual(c.entries[1].holder, to);
  assert.strictEqual(c.entries[1].points, 340);
  assert.ok(c.entries.every((e) => e.ref === 'CLAIM-1'), 'the two halves must carry the same ref');
});

it('⚠️ and it is refused where it would move somebody elses balance or invent one', () => {
  const ph = { scheme: 'phone', value: '9840012345' }, id = { scheme: 'identity', value: 'cust-9' };
  assert.strictEqual(R.claim({ points: 340 }, id, ph, 'x').ok, false, 'claimed onto a phone number');
  assert.strictEqual(R.claim({ points: 0 }, ph, id, 'x').ok, false, 'claimed an empty balance');
  assert.strictEqual(R.claim({ points: 340 }, ph, ph, 'x').ok, false, 'claimed onto itself');
  assert.strictEqual(R.claim({ points: 340 }, null, id, 'x').entries.length, 0,
    'a refused claim must return no entries at all');
});

console.log(pass + ' checks');
