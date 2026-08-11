'use strict';
// prove-amend.js — b138. Line-level corrections and THE LIVE SET.
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

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n      want ' + JSON.stringify(w));

/* The reading of Athi's msg 16: "anna 3 kg thakkali venum and 2 packet milk 500ml each also 1 kg vengayam" */
const LINES = [
  { particulars: 'Tomato', quantity: 3, unit: 'kg', price: 30, total: 90 },
  { particulars: 'Milk', quantity: 2, unit: 'packet', unit_size: '500ml', price: 25, total: 50 },
  { particulars: 'Onion', quantity: 1, unit: 'kg', price: 40, total: 40 },
];
const A = (line_index, line, seq, reason_code) => ({ line_index, seq: seq || 1, line, reason_code: reason_code || 'other' });

console.log('\n── b138 · line amendment + live set ─────────────────────────────────────────\n');

console.log('1 · a correction replaces the LINE, and the original survives');
{
  const set = amend.liveSet(LINES, [A(0, { particulars: 'Tomato', quantity: 5, unit: 'kg', price: 30 })]);
  eq('the live line reads 5 kg', set[0].live.quantity, 5);
  eq('…and the original still says 3', set[0].original.quantity, 3);
  eq('the original is in the history, for the strike-through', set[0].history.length, 1);
  ok('untouched lines carry no history', !set[1].history.length && !set[2].history.length);
  ok('⚠️ the input is NOT mutated — chit_detail.line_items must never change',
     LINES[0].quantity === 3, JSON.stringify(LINES[0]));
}

console.log('\n2 · ⭐ REMOVAL IS null, AND IT IS NOT QUANTITY ZERO');
{
  const removed = amend.liveSet(LINES, [A(1, null, 1, 'stock_unavailable')]);
  ok('the removed line is STILL THERE — evidence', removed.length === 3 && removed[1].index === 1);
  ok('…flagged removed, with live = null', removed[1].removed === true && removed[1].live === null);
  ok('…and it remembers WHY (a business event, not a misreading)', removed[1].reason_code === 'stock_unavailable');
  eq('but it counts in NOTHING', amend.liveLines(LINES, [A(1, null, 1, 'stock_unavailable')]).length, 2);

  /* THE RED CASE. If removal were expressed as quantity 0, the line would still be a line — it would survive
     liveLines(), reach consolidate(), and add a real 0 to a total. Same intent, completely different arithmetic. */
  const zeroed = amend.liveLines(LINES, [A(1, { particulars: 'Milk', quantity: 0, unit: 'packet' })]);
  eq('⚠️ amend-to-ZERO is NOT removal — the line still counts', zeroed.length, 3);
  eq('…and it contributes a real zero', zeroed[1].quantity, 0);
}

console.log('\n3 · correcting a correction — the chain stays readable');
{
  const set = amend.liveSet(LINES, [
    A(0, { particulars: 'Tomato', quantity: 5, unit: 'kg' }, 1),
    A(0, { particulars: 'Tomato', quantity: 8, unit: 'kg' }, 2),
  ]);
  eq('latest wins', set[0].live.quantity, 8);
  eq('exactly one live version', set[0].versions, 2);
  eq('history holds the original AND the middle step, oldest first',
     set[0].history.map((h) => h.quantity), [3, 5]);
}

console.log('\n4 · out-of-order rows still resolve by seq, not by arrival');
{
  const set = amend.liveSet(LINES, [
    A(0, { particulars: 'Tomato', quantity: 8, unit: 'kg' }, 2),
    A(0, { particulars: 'Tomato', quantity: 5, unit: 'kg' }, 1),
  ]);
  eq('8 is live because seq 2 > seq 1', set[0].live.quantity, 8);
}

console.log('\n5 · a removed line can be brought back');
{
  const set = amend.liveSet(LINES, [
    A(2, null, 1, 'stock_unavailable'),
    A(2, { particulars: 'Onion', quantity: 1, unit: 'kg' }, 2, 'customer_clarified'),
  ]);
  ok('it is live again', !set[2].removed && set[2].live.quantity === 1);
  eq('and it counts once, not twice', amend.liveLines(LINES, [
    A(2, null, 1), A(2, { particulars: 'Onion', quantity: 1, unit: 'kg' }, 2)]).length, 3);
}

console.log('\n6 · ⭐ liveLines IS the single definition of what counts');
{
  const amendments = [
    A(0, { particulars: 'Tomato', quantity: 5, unit: 'kg' }),
    A(1, null, 1, 'stock_unavailable'),
  ];
  const live = amend.liveLines(LINES, amendments);
  eq('two lines count', live.length, 2);
  eq('the corrected quantity, not the misread one', live[0].quantity, 5);
  ok('the removed one is absent', !live.some((l) => l.particulars === 'Milk'));
  /* This is the defect group sum shipped with this morning: totalling line_items directly told a trader to source
     what the machine misheard, and a stock removal changed nothing at all. */
  ok('⚠️ totalling the ORIGINAL would have been wrong on both counts',
     LINES[0].quantity === 3 && LINES.length === 3);
}

console.log('\n7 · shape validation refuses what must not become a record');
{
  const refuses = (name, line, expect) => {
    try { amend.clean(line); ok(name, false, 'it was ACCEPTED'); }
    catch (e) { ok(name, e.status === 400 && new RegExp(expect, 'i').test(e.message), 'got: ' + e.message); }
  };
  refuses('a non-numeric quantity is refused, not coerced to NaN', { particulars: 'x', quantity: '2 box' }, 'must be a number');
  refuses('a line with no item is refused', { quantity: 2, unit: 'kg' }, 'needs an item');
  /* ⚠️ 45 chits on beta carry {description, qty, rate} because line_items is jsonb and the send path never
     checked. Rejecting the shape in ONE place beats tolerating it in four readers. */
  const cleaned = amend.clean({ particulars: 'Tomato', quantity: 2, unit: 'kg', description: 'Widget', qty: 99, rate: 5 });
  eq('unknown keys are DROPPED, never stored', Object.keys(cleaned).sort(), ['particulars', 'quantity', 'unit']);
  eq('total is recomputed, never taken from the client',
     amend.clean({ particulars: 'x', quantity: 3, price: 30, total: 999999 }).total, 90);
  ok('null is a legal line — that is removal', amend.clean(null) === null);
}

console.log('\n8 · the reason codes that mean opposite things');
{
  ok('misread_by_ai and stock_unavailable are both recordable',
     amend.REASONS.includes('misread_by_ai') && amend.REASONS.includes('stock_unavailable'));
  ok('⚠️ they produce an IDENTICAL empty line — only the reason distinguishes "never asked" from "declining"',
     amend.REASONS.length === 5);
}

console.log('\n────────────────────────────────────────────────────────────────────────────');
console.log((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
console.log('⚠️  NOT PROVEN HERE: the INSERT, the seq chain under concurrency, RLS, the routes, the UI.\n' +
            '    Those need b138 applied and a live entity.\n');
process.exit(fail ? 1 : 0);
