'use strict';
// prove-groupsum.js — 🧮 the group-sum money path, proved without a database.
//
// Athi, 2026-08-11: *"sum all the tasks and find out the total requirement… say 10 parties ordered 1000Kg, on
// click the down below need to know who are all asked."*
//
// ⚠️ SCOPE. This proves the two things group-sum ADDS: the per-party roster carrying a cost, and the rules that
// stop that cost from lying. It does NOT re-prove the requirement arithmetic — that is lib/consolidate.js, already
// proved 27/0 by prove-wholesaler.js, and re-asserting it here would just be a second opinion from the same code.
// It also does not prove the row-gathering, which needs a database.
//
// Run: node scripts/prove-groupsum.js
const { attachValue, lineKey } = require('../lib/groupsum');
const consolidate = require('../lib/consolidate');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n      want ' + JSON.stringify(w));

/* A catalogue where tomato has synonyms and orange has grades — the two rules that must not bend. */
const CAT = {
  items: [
    { name: 'Tomato', variant: '', unit: 'kg', price: 30, synonyms: ['thakkali', 'tomatto'], conversions: {}, key: 'tomato|' },
    { name: 'Orange', variant: 'grade 1', unit: 'kg', price: 90, synonyms: [], conversions: {}, key: 'orange|grade 1' },
    { name: 'Orange', variant: 'grade 2', unit: 'kg', price: 60, synonyms: [], conversions: {}, key: 'orange|grade 2' },
  ],
  variantsOf: { tomato: new Set(['']), orange: new Set(['grade 1', 'grade 2']) },
};

const req = (chit, who, particulars, qty, unit) => ({
  store_id: who, store_name: who, chit_id: chit, fulfil_date: 'all',
  lines: [{ particulars, qty, unit: unit || 'kg' }],
});

console.log('\n── 🧮 group sum ─────────────────────────────────────────────────────────────\n');

console.log('1 · ten parties, one requirement, and the roster survives');
{
  const reqs = [];
  for (let i = 1; i <= 10; i++) reqs.push(req('c' + i, 'Shop ' + i, i % 2 ? 'thakkali' : 'tomato', 100, 'kg'));
  const out = consolidate.consolidate(reqs, CAT);
  eq('one line, not ten', out.lines.length, 1);
  eq('1000 kg total — spelling never fragments it', out.lines[0].total, 1000);
  eq('and all ten are still named underneath', (out.lines[0].breakdown || []).length, 10);
  ok('the line is the CANONICAL name, not what the last shop typed', out.lines[0].item === 'Tomato', out.lines[0].item);
}

console.log('\n2 · cost rides along, per party and per line');
{
  const reqs = [req('c1', 'Shop A', 'tomato', 100, 'kg'), req('c2', 'Shop B', 'thakkali', 50, 'kg')];
  const out = consolidate.consolidate(reqs, CAT);
  const prices = new Map([
    [lineKey('c1', { particulars: 'tomato', quantity: 100, unit: 'kg' }), { price: 30, currency: 'INR' }],
    [lineKey('c2', { particulars: 'thakkali', quantity: 50, unit: 'kg' }), { price: 32, currency: 'INR' }],
  ]);
  attachValue(out.lines, prices);
  const l = out.lines[0];
  eq('line value = 100x30 + 50x32', l.value, [{ currency: 'INR', total: 4600 }]);
  eq('each party carries its own cost', (l.breakdown || []).map((b) => b.value), [3000, 1600]);
  ok('and no partial flag when everything was priced', !l.value_partial);
}

console.log('\n3 · ⚠️ AN UNPRICED LINE IS NOT A FREE LINE');
{
  const reqs = [req('c1', 'Shop A', 'tomato', 100, 'kg'), req('c2', 'Shop B', 'tomato', 50, 'kg')];
  const out = consolidate.consolidate(reqs, CAT);
  const prices = new Map([
    [lineKey('c1', { particulars: 'tomato', quantity: 100, unit: 'kg' }), { price: 30, currency: 'INR' }],
    [lineKey('c2', { particulars: 'tomato', quantity: 50, unit: 'kg' }), { price: null, currency: 'INR' }],
  ]);
  attachValue(out.lines, prices);
  const l = out.lines[0];
  eq('the priced part totals honestly', l.value, [{ currency: 'INR', total: 3000 }]);
  /* THE RED CASE: if null had been coerced with Number(), Shop B would contribute 50x0 = 0 and the line would
     read "fully priced, 3000" — understating the cost while looking complete. money.js shipped that bug once. */
  eq('and the line SAYS it is partial', l.value_partial, { priced: 1, unpriced: 1 });
  eq('the unpriced party shows a dash, not a zero', l.breakdown[1].value, null);
  ok('quantity is unaffected — 150 kg is still needed whatever it costs', l.total === 150, String(l.total));
}

console.log('\n4 · ⚠️ CURRENCIES ARE NEVER ADDED TOGETHER');
{
  const reqs = [req('c1', 'Shop A', 'tomato', 100, 'kg'), req('c2', 'Shop B', 'tomato', 10, 'kg')];
  const out = consolidate.consolidate(reqs, CAT);
  attachValue(out.lines, new Map([
    [lineKey('c1', { particulars: 'tomato', quantity: 100, unit: 'kg' }), { price: 30, currency: 'INR' }],
    [lineKey('c2', { particulars: 'tomato', quantity: 10, unit: 'kg' }), { price: 2, currency: 'USD' }],
  ]));
  const l = out.lines[0];
  eq('reported side by side', l.value, [{ currency: 'INR', total: 3000 }, { currency: 'USD', total: 20 }]);
  ok('and flagged as mixed', l.value_mixed === true);
  ok('there is NO single combined figure anywhere on the line',
     !Object.keys(l).some((k) => k !== 'value' && typeof l[k] === 'number' && l[k] === 3020));
}

console.log('\n5 · ⚠️ VARIANTS ARE NEVER MERGED, so their costs cannot be either');
{
  const out = consolidate.consolidate([
    req('c1', 'Shop A', 'orange grade 1', 10, 'kg'),
    req('c2', 'Shop B', 'orange grade 2', 10, 'kg'),
  ], CAT);
  eq('two lines, not one', out.lines.length, 2);
  ok('grade 1 and grade 2 are separate items', out.lines[0].variant !== out.lines[1].variant);
}

console.log('\n6 · ⚠️ AN UNRESOLVED ITEM IS EXCLUDED AND FLAGGED, never folded into a total');
{
  const out = consolidate.consolidate([
    req('c1', 'Shop A', 'tomato', 100, 'kg'),
    req('c2', 'Shop B', 'dragonfruit', 5, 'kg'),
  ], CAT);
  eq('only the resolved item is totalled', out.lines.length, 1);
  eq('the other is named in the flags', (out.flags.unmatched || []).length, 1);
  ok('a reader can see WHICH shop asked for it', (out.flags.unmatched[0] || {}).store_name === 'Shop B');
}

console.log('\n7 · the price index cannot pick the wrong line');
{
  ok('same chit + same phrase + different qty ⇒ different key',
     lineKey('c1', { particulars: 'tomato', quantity: 10, unit: 'kg' }) !== lineKey('c1', { particulars: 'tomato', quantity: 20, unit: 'kg' }));
  ok('same chit + same phrase + different unit ⇒ different key',
     lineKey('c1', { particulars: 'tomato', quantity: 10, unit: 'kg' }) !== lineKey('c1', { particulars: 'tomato', quantity: 10, unit: 'crate' }));
  ok('different chits never share a key',
     lineKey('c1', { particulars: 'tomato', quantity: 10, unit: 'kg' }) !== lineKey('c2', { particulars: 'tomato', quantity: 10, unit: 'kg' }));
  ok('a missing price is treated as UNPRICED, not as zero — a lookup miss must never invent a cost',
     (function () { const l = [{ breakdown: [{ chit_id: 'zz', phrase: 'x', qty: 5, unit: 'kg' }] }];
       attachValue(l, new Map()); return l[0].value.length === 0 && l[0].value_partial.unpriced === 1; })());
}

console.log('\n────────────────────────────────────────────────────────────────────────────');
console.log((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
console.log('⚠️  NOT PROVEN HERE: row gathering (needs a DB) and the UI. The requirement arithmetic itself is\n' +
            '    lib/consolidate.js, proved separately by prove-wholesaler.js (27/0).\n');
process.exit(fail ? 1 : 0);
