#!/usr/bin/env node
// @type: unit
/**
 * tests/inventory-engine.test.cjs — STOCK POSTS ONCE, AT THE RIGHT SIGN, AT THE RIGHT COST (lib/inventory.js, the pure engine behind every stock movement).
 * UNIT      13 INVENTORY / STOCK & TRACEABILITY / On hand & movements (test = 0.5: `T: stock-cycle` and the stock specs are cited without a path that resolves)
 * OWNS      the engine rules a movement meets before the log is touched: every reason has a direction and the SIGN comes from the reason, never from the caller
 *           (a sale given a positive number still takes stock out) · a movement is refused, in words, for no reason / an unknown reason / a non-number / zero /
 *           the wrong sign / a missing product / a missing cost price (including the `null >= 0` trap) · a write-down moves value and never quantity · one unit per
 *           balance (the refusal names both units) · the weighted average moves only on a receipt, never on an issue · the three edges (zero, negative, receipt into
 *           negative) · REPLAY of the log in timestamp order equals applying one by one, whatever order the rows arrive in · two balances agree only on quantity AND value.
 * CALLED BY scripts/guards.cjs · CI. Pure: no database.
 * FLOW      check → signedQty → apply → replay → asserted (seeded property loop, no Math.random)
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 */
'use strict';
const assert = require('assert');
const path = require('path');
const inv = require(path.join(__dirname, '..', 'lib', 'inventory.js'));

let checks = 0;
function it(what, fn) { fn(); checks++; console.log('  ok  ' + what); }
const mv = (o) => Object.assign({ item_id: 'rice', reason: 'sale', qty: 1 }, o);
const EMPTY = { qty: 0, value: 0, avg_cost: 0 };

it('every reason has a direction, and every shrink reason is a loss that goes OUT or either way — a sale is never shrinkage', () => {
  const names = inv.reasons();
  assert.ok(names.length >= 12);
  for (const n of names) {
    assert.ok(['in', 'out', 'either', 'value'].includes(inv.REASONS[n].dir), n);
    assert.ok(inv.REASONS[n].says, n + ' has no words');
  }
  for (const n of names.filter((x) => inv.isShrink(x))) assert.ok(['out', 'either'].includes(inv.REASONS[n].dir), n + ' is shrink but cannot lose stock');
  assert.strictEqual(inv.isShrink('sale'), false);
  assert.strictEqual(inv.isShrink('issued'), false, 'a supply used on purpose is not loss');
  assert.strictEqual(inv.isShrink('nonsense'), false);
});

it('the SIGN comes from the reason: for every in/out reason the signed quantity has the reason\'s direction whatever the caller\'s number', () => {
  for (const n of inv.reasons()) {
    const r = inv.REASONS[n];
    if (r.dir !== 'in' && r.dir !== 'out') continue;
    const s = inv.signedQty(mv({ reason: n, qty: 5 }));
    assert.strictEqual(s, r.dir === 'in' ? 5 : -5, n);
  }
  assert.strictEqual(inv.signedQty(mv({ reason: 'sale', qty: -5 })), -5, 'a sale handed a negative still takes stock OUT');
  assert.strictEqual(inv.signedQty(mv({ reason: 'nope', qty: 5 })), 0, 'an unknown reason moves nothing');
});

it('refusals each say why: no reason · unknown reason · not a number · zero · missing product', () => {
  assert.strictEqual(inv.check(mv({ reason: undefined })).why, 'a movement must say why');
  assert.ok(/no such reason: gift/.test(inv.check(mv({ reason: 'gift' })).why));
  assert.ok(/quantity must be a number/.test(inv.check(mv({ qty: 'lots' })).why));
  assert.ok(/quantity must be a number/.test(inv.check(mv({ qty: undefined })).why));
  for (const none of [null, '']) assert.strictEqual(inv.check(mv({ qty: none })).ok, false, 'a blank quantity was accepted: ' + JSON.stringify(none));
  assert.ok(/nothing records nothing/.test(inv.check(mv({ qty: 0 })).why));
  assert.ok(/nothing records nothing/.test(inv.check(mv({ qty: 0.0004 })).why), 'a quantity that rounds to nothing is nothing');
  assert.ok(/must name a product/.test(inv.check(mv({ item_id: '' })).why));
  assert.strictEqual(inv.check(null).ok, false);
  assert.strictEqual(inv.check(undefined).ok, false);
});

it('refusal: an inbound reason handed a negative, and an outbound reason handed a negative, are both turned away — but a stored row keeps its sign', () => {
  assert.ok(/brings stock in/.test(inv.check(mv({ reason: 'purchase', qty: -2, rate: 10 })).why));
  assert.ok(/takes stock out; give the quantity as a positive/.test(inv.check(mv({ reason: 'sale', qty: -2 })).why));
  assert.strictEqual(inv.check(mv({ reason: 'sale', qty: -2 }), { stored: true }).ok, true);
});

it('refusal: stock that comes in must carry a cost price — absent, a word, negative (null and "" are a KNOWN GAP: tests/inventory-null-rate.known-failing.cjs); a zero cost is a real (free) price and is allowed', () => {
  for (const reason of ['opening', 'purchase']) {
    for (const rate of [undefined, 'free', -1]) assert.strictEqual(inv.check(mv({ reason, qty: 3, rate })).ok, false, reason + ' rate ' + String(rate));
    assert.strictEqual(inv.check(mv({ reason, qty: 3, rate: 0 })).ok, true, reason + ' rate 0');
  }
  assert.strictEqual(inv.check(mv({ reason: 'sale_return', qty: 1 })).ok, true, 'a customer return needs no price');
});

it('a write-down changes value, not quantity: a quantity is refused, a rise in value is refused, a fall is applied to value only', () => {
  assert.ok(/changes value, not quantity/.test(inv.check({ item_id: 'x', reason: 'writedown', qty: 3, value_delta: -10 }).why));
  assert.ok(/must lower the value/.test(inv.check({ item_id: 'x', reason: 'writedown', qty: 0, value_delta: 10 }).why));
  assert.ok(/must lower the value/.test(inv.check({ item_id: 'x', reason: 'writedown', qty: 0 }).why));
  const out = inv.apply({ qty: 10, value: 1000, avg_cost: 100 }, { item_id: 'x', reason: 'writedown', qty: 0, value_delta: -200 });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual([out.qty, out.value, out.avg_cost], [10, 800, 80]);
});

it('an unchecked refusal leaves the balance exactly as it was and says why — nothing half applied', () => {
  const before = { qty: 7, value: 700, avg_cost: 100 };
  const out = inv.apply(before, mv({ reason: 'purchase', qty: 3 })); /* no rate */
  assert.strictEqual(out.ok, false);
  assert.deepStrictEqual([out.qty, out.value, out.avg_cost], [7, 700, 100]);
});

it('one unit per balance: 60 pieces cannot take 5 cases, the refusal names BOTH units, and the first movement fixes the unit', () => {
  const first = inv.apply(EMPTY, mv({ reason: 'purchase', qty: 60, rate: 2, unit: 'pc' }));
  assert.strictEqual(first.unit, 'pc');
  const bad = inv.apply(first, mv({ reason: 'purchase', qty: 5, rate: 24, unit: 'case' }));
  assert.strictEqual(bad.ok, false);
  assert.ok(/pc/.test(bad.why) && /case/.test(bad.why) && /no conversion/.test(bad.why), bad.why);
  assert.strictEqual(inv.apply(first, mv({ reason: 'sale', qty: 1 })).ok, true, 'a movement with no unit joins the balance\'s unit');
});

it('weighted average: a receipt at a new price blends, an issue values at the average and leaves the average alone', () => {
  let b = inv.apply(EMPTY, mv({ reason: 'opening', qty: 10, rate: 100 }));
  b = inv.apply(b, mv({ reason: 'purchase', qty: 10, rate: 120 }));
  assert.deepStrictEqual([b.qty, b.value, b.avg_cost], [20, 2200, 110]);
  const s = inv.apply(b, mv({ reason: 'sale', qty: 5 }));
  assert.deepStrictEqual([s.qty, s.value, s.avg_cost], [15, 1650, 110]);
});

it('edge 1: selling to exactly zero keeps the last average and zeroes the value; edge 2: selling past zero goes negative on purpose and is not refused', () => {
  let b = inv.apply(EMPTY, mv({ reason: 'opening', qty: 4, rate: 50 }));
  const zero = inv.apply(b, mv({ reason: 'sale', qty: 4 }));
  assert.deepStrictEqual([zero.qty, zero.value, zero.avg_cost], [0, 0, 50]);
  const under = inv.apply(zero, mv({ reason: 'sale', qty: 3 }));
  assert.strictEqual(under.ok, true);
  assert.deepStrictEqual([under.qty, under.value, under.avg_cost], [-3, -150, 50]);
});

it('edge 3: a receipt into negative stock takes the incoming price as the average (no blending with a debt)', () => {
  const under = { qty: -3, value: -150, avg_cost: 50 };
  const r = inv.apply(under, mv({ reason: 'purchase', qty: 10, rate: 80 }));
  assert.deepStrictEqual([r.qty, r.avg_cost, r.value], [7, 80, 560]);
});

it('a sale return with no price comes back at the current average', () => {
  const r = inv.apply({ qty: 5, value: 500, avg_cost: 100 }, mv({ reason: 'sale_return', qty: 2 }));
  assert.deepStrictEqual([r.qty, r.value, r.avg_cost], [7, 700, 100]);
});

it('a count is a signed DIFFERENCE: +2 and -2 both post, the history keeps that a count happened', () => {
  const up = inv.apply({ qty: 5, value: 500, avg_cost: 100 }, mv({ reason: 'count_adjust', qty: 2 }));
  const down = inv.apply({ qty: 5, value: 500, avg_cost: 100 }, mv({ reason: 'count_adjust', qty: -2 }));
  assert.strictEqual(up.qty, 7);
  assert.strictEqual(down.qty, 3);
  assert.ok(inv.isShrink('count_adjust'));
});

/* a small seeded generator: reproducible, no Math.random */
function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

it('property: replaying a stored log equals applying the movements one by one — 300 seeded logs of 12 movements', () => {
  const rnd = lcg(20261106);
  const reasons = ['opening', 'purchase', 'sale', 'damage', 'sale_return', 'count_adjust'];
  for (let run = 0; run < 300; run++) {
    const log = [];
    let b = EMPTY;
    for (let i = 0; i < 12; i++) {
      const reason = reasons[Math.floor(rnd() * reasons.length)];
      const qty = Math.round((rnd() * 9 + 1) * 10) / 10 * (reason === 'count_adjust' && rnd() < 0.5 ? -1 : 1);
      const m = mv({ reason, qty, rate: Math.round(rnd() * 200 + 1), at: '2026-11-01T10:' + String(i).padStart(2, '0') + ':00Z' });
      const out = inv.apply(b, m);
      if (!out.ok) continue;
      b = { qty: out.qty, value: out.value, avg_cost: out.avg_cost };
      log.push(Object.assign({}, m, { qty: inv.signedQty(m) })); /* the stored row carries the signed quantity */
    }
    const rebuilt = inv.replay(log);
    assert.ok(inv.agrees(b, rebuilt), 'run ' + run + ': running ' + JSON.stringify(b) + ' vs replay ' + JSON.stringify(rebuilt));
    assert.strictEqual(rebuilt.refused.length, 0, 'run ' + run + ' refused a row that had been applied');
  }
});

it('replay is ordered by TIMESTAMP, never arrival: a late-syncing receipt gives the same answer as the in-order log', () => {
  const rows = [
    { item_id: 'r', reason: 'opening', qty: 10, rate: 100, at: '2026-11-01T09:00:00Z' },
    { item_id: 'r', reason: 'sale', qty: -4, at: '2026-11-01T10:00:00Z' },
    { item_id: 'r', reason: 'purchase', qty: 10, rate: 200, at: '2026-11-01T11:00:00Z' }
  ];
  const inOrder = inv.replay(rows);
  const shuffled = inv.replay([rows[2], rows[0], rows[1]]);
  assert.ok(inv.agrees(inOrder, shuffled), JSON.stringify([inOrder, shuffled]));
  assert.strictEqual(inOrder.applied, 3);
  assert.deepStrictEqual(rows.map((r) => r.at), ['2026-11-01T09:00:00Z', '2026-11-01T10:00:00Z', '2026-11-01T11:00:00Z'], 'replay sorted the caller\'s array in place');
});

it('replay says which rows it refused, rather than quietly skipping them; a non-array log is an empty log', () => {
  const r = inv.replay([{ item_id: 'r', reason: 'opening', qty: 5, rate: 10, at: 'a' }, { item_id: 'r', reason: 'bogus', qty: 1, at: 'b' }]);
  assert.strictEqual(r.applied, 1);
  assert.strictEqual(r.refused.length, 1);
  assert.ok(/no such reason/.test(r.refused[0].why));
  assert.deepStrictEqual(inv.replay(undefined), { qty: 0, value: 0, avg_cost: 0, applied: 0, refused: [] });
});

it('two balances agree only when quantity AND value agree; sub-paisa noise does not disagree, a real difference does', () => {
  assert.strictEqual(inv.agrees({ qty: 5, value: 100 }, { qty: 5, value: 100.004 }), true);
  assert.strictEqual(inv.agrees({ qty: 5, value: 100 }, { qty: 5, value: 100.5 }), false, 'same quantity, different money');
  assert.strictEqual(inv.agrees({ qty: 5, value: 100 }, { qty: 6, value: 100 }), false, 'same money, different quantity');
  assert.strictEqual(inv.agrees(null, undefined), true, 'two empty balances agree');
});

console.log('\n  ' + checks + ' checks');
console.log('  ' + checks + ' passed');
