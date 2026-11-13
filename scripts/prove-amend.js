'use strict';
// prove-amend.js — b138. Line-level corrections and THE LIVE SET.
// OWNS      the proof of the b138 pure layer: liveSet / liveLines, removal is null (never quantity 0), the shape check before any DB call
// CALLED BY tests/amend-live-set.test.cjs (the offline guards, RAIL-128) · by hand: node scripts/prove-amend.js
// FLOW      LINES fixture → lib/amend liveSet · liveLines · clean · REASONS → ✓ / ✗ per case → exit 1 on any ✗
// CARD 01-rail-core-the-chit/amend-reprice-costs
//
// Athi, 2026-08-11: *"just new line item, with all the amendments"* · *"old line deleted and new line is nothing
// — assume if the stock is not available the sku line will become empty."*
//
// ⚠️ SCOPE. The pure layer: liveSet/liveLines and the shape validation that runs before any DB call. No database,
// no migration needed. It does NOT prove the INSERT, the seq chain under concurrency, the RLS policy, the routes
// or the UI — those need b138 applied and a live entity.
//
// Run: node scripts/prove-amend.js
const amend = require('../lib/amend');

let pass = 0,
  fail = 0;
const ok = (n, c, d) => {
  if (c) {
    pass++;
    console.log('  ✓ ' + n);
  } else {
    fail++;
    console.log('  ✗ ' + n + (d ? '\n      ' + d : ''));
  }
};
const expectEqual = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n      want ' + JSON.stringify(w));

/* The reading of Athi's msg 16: "anna 3 kg thakkali venum and 2 packet milk 500ml each also 1 kg vengayam" */
const LINES = [
  { particulars: 'Tomato', quantity: 3, unit: 'kg', price: 30, total: 90 },
  { particulars: 'Milk', quantity: 2, unit: 'packet', unit_size: '500ml', price: 25, total: 50 },
  { particulars: 'Onion', quantity: 1, unit: 'kg', price: 40, total: 40 }
];
const amendment = (line_index, line, seq, reason_code) => ({ line_index, seq: seq || 1, line, reason_code: reason_code || 'other' });

console.log('\n── b138 · line amendment + live set ─────────────────────────────────────────\n');

console.log('1 · a correction replaces the LINE, and the original survives');
{
  const set = amend.liveSet(LINES, [amendment(0, { particulars: 'Tomato', quantity: 5, unit: 'kg', price: 30 })]);
  expectEqual('the live line reads 5 kg', set[0].live.quantity, 5);
  expectEqual('…and the original still says 3', set[0].original.quantity, 3);
  expectEqual('the original is in the history, for the strike-through', set[0].history.length, 1);
  ok('untouched lines carry no history', !set[1].history.length && !set[2].history.length);
  ok('⚠️ the input is NOT mutated — chit_detail.line_items must never change', LINES[0].quantity === 3, JSON.stringify(LINES[0]));
}

console.log('\n2 · ⭐ REMOVAL IS null, AND IT IS NOT QUANTITY ZERO');
{
  const removed = amend.liveSet(LINES, [amendment(1, null, 1, 'stock_unavailable')]);
  ok('the removed line is STILL THERE — evidence', removed.length === 3 && removed[1].index === 1);
  ok('…flagged removed, with live = null', removed[1].removed === true && removed[1].live === null);
  ok('…and it remembers WHY (a business event, not a misreading)', removed[1].reason_code === 'stock_unavailable');
  expectEqual('but it counts in NOTHING', amend.liveLines(LINES, [amendment(1, null, 1, 'stock_unavailable')]).length, 2);

  /* THE RED CASE. If removal were expressed as quantity 0, the line would still be a line — it would survive
     liveLines(), reach consolidate(), and add a real 0 to a total. Same intent, completely different arithmetic. */
  const zeroed = amend.liveLines(LINES, [amendment(1, { particulars: 'Milk', quantity: 0, unit: 'packet' })]);
  expectEqual('⚠️ amend-to-ZERO is NOT removal — the line still counts', zeroed.length, 3);
  expectEqual('…and it contributes a real zero', zeroed[1].quantity, 0);
}

console.log('\n3 · correcting a correction — the chain stays readable');
{
  const set = amend.liveSet(LINES, [amendment(0, { particulars: 'Tomato', quantity: 5, unit: 'kg' }, 1), amendment(0, { particulars: 'Tomato', quantity: 8, unit: 'kg' }, 2)]);
  expectEqual('latest wins', set[0].live.quantity, 8);
  expectEqual('exactly one live version', set[0].versions, 2);
  expectEqual(
    'history holds the original AND the middle step, oldest first',
    set[0].history.map((item) => item.quantity),
    [3, 5]
  );
}

console.log('\n4 · out-of-order rows still resolve by seq, not by arrival');
{
  const set = amend.liveSet(LINES, [amendment(0, { particulars: 'Tomato', quantity: 8, unit: 'kg' }, 2), amendment(0, { particulars: 'Tomato', quantity: 5, unit: 'kg' }, 1)]);
  expectEqual('8 is live because seq 2 > seq 1', set[0].live.quantity, 8);
}

console.log('\n5 · a removed line can be brought back');
{
  const set = amend.liveSet(LINES, [amendment(2, null, 1, 'stock_unavailable'), amendment(2, { particulars: 'Onion', quantity: 1, unit: 'kg' }, 2, 'customer_clarified')]);
  ok('it is live again', !set[2].removed && set[2].live.quantity === 1);
  expectEqual('and it counts once, not twice', amend.liveLines(LINES, [amendment(2, null, 1), amendment(2, { particulars: 'Onion', quantity: 1, unit: 'kg' }, 2)]).length, 3);
}

console.log('\n6 · ⭐ liveLines IS the single definition of what counts');
{
  const amendments = [amendment(0, { particulars: 'Tomato', quantity: 5, unit: 'kg' }), amendment(1, null, 1, 'stock_unavailable')];
  const live = amend.liveLines(LINES, amendments);
  expectEqual('two lines count', live.length, 2);
  expectEqual('the corrected quantity, not the misread one', live[0].quantity, 5);
  ok('the removed one is absent', !live.some((item) => item.particulars === 'Milk'));
  /* This is the defect group sum shipped with this morning: totalling line_items directly told a trader to source
     what the machine misheard, and a stock removal changed nothing at all. */
  ok('⚠️ totalling the ORIGINAL would have been wrong on both counts', LINES[0].quantity === 3 && LINES.length === 3);
}

console.log('\n7 · shape validation refuses what must not become a record');
{
  const refuses = (name, line, expect) => {
    try {
      amend.clean(line);
      ok(name, false, 'it was ACCEPTED');
    } catch (e) {
      ok(name, e.status === 400 && new RegExp(expect, 'i').test(e.message), 'got: ' + e.message);
    }
  };
  refuses('a non-numeric quantity is refused, not coerced to NaN', { particulars: 'x', quantity: '2 box' }, 'must be a number');
  refuses('a line with no item is refused', { quantity: 2, unit: 'kg' }, 'needs an item');
  /* ⚠️ 45 chits on beta carry {description, qty, rate} because line_items is jsonb and the send path never
     checked. Rejecting the shape in ONE place beats tolerating it in four readers. */
  const cleaned = amend.clean({ particulars: 'Tomato', quantity: 2, unit: 'kg', description: 'Widget', qty: 99, rate: 5 });
  expectEqual('unknown keys are DROPPED, never stored', Object.keys(cleaned).sort(), ['particulars', 'quantity', 'unit']);
  expectEqual('total is recomputed, never taken from the client', amend.clean({ particulars: 'x', quantity: 3, price: 30, total: 999999 }).total, 90);
  ok('null is a legal line — that is removal', amend.clean(null) === null);
}

console.log('\n8 · the reason codes that mean opposite things');
{
  ok('misread_by_ai and stock_unavailable are both recordable', amend.REASONS.includes('misread_by_ai') && amend.REASONS.includes('stock_unavailable'));
  /* RAIL-128: this case once checked REASONS.length === 5 and broke when 'other' joined; it now proves what it says */
  const asRemoved = (reason) => { const { reason_code, ...rest } = amend.liveSet(LINES, [amendment(1, null, 1, reason)])[1]; return { reason_code, rest }; };
  const misread = asRemoved('misread_by_ai'), declined = asRemoved('stock_unavailable');
  expectEqual('⚠️ they produce an IDENTICAL empty line — only the reason distinguishes "never asked" from "declining"', misread.rest, declined.rest);
  ok('…and the reason is what tells them apart', misread.reason_code === 'misread_by_ai' && declined.reason_code === 'stock_unavailable');
}

console.log('\n────────────────────────────────────────────────────────────────────────────');
console.log((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
console.log(
  '⚠️  NOT PROVEN HERE: the INSERT, the seq chain under concurrency, RLS, the routes, the UI.\n' + '    Those need b138 applied and a live entity.\n'
);
process.exit(fail ? 1 : 0);
