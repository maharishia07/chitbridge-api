'use strict';
// prove-amend.js — b137. Corrections are recorded ALONGSIDE the reading, never over it.
//
// ⚠️ WHAT THIS PROVES AND WHAT IT DOES NOT. It exercises the pure layer — apply() and the validation that runs
// before any DB call — so it needs no database and no migration. It does NOT prove the INSERT, the RLS policy, or
// the route. Those need b137 applied and a live entity; a green run here is not a green run of the feature.
//
// Run: node scripts/prove-amend.js
const amend = require('../lib/amend');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got  ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want));

/* The line the reader actually produced from Athi's message on 2026-08-11:
   "screw black color 5 inch + type 2 box" — the SIZE became the quantity, "5 inch" vanished, and `unplaced` was
   empty, so the silent-loss detector reported it clean. This is the line an amendment exists for. */
const LINES = [
  { particulars: 'screw', quantity: 5, unit: 'box', comment: 'black color, type 2', price: null },
  { particulars: 'thakkali', quantity: 10, unit: 'kg', price: null },
];

console.log('\n── b137 · amend ─────────────────────────────────────────────────────────────\n');

console.log('1 · the original reading survives the correction');
{
  const amendments = [
    { line_index: 0, field: 'quantity', old_value: '5', new_value: '2', kind: 'reading' },
    { line_index: 0, field: 'unit_size', old_value: null, new_value: '5 inch', kind: 'reading' },
  ];
  const out = amend.apply(LINES, amendments);
  eq('quantity now reads 2', out[0].quantity, 2);
  eq('…and still remembers it was read as 5', out[0]._amended.quantity, { from: '5', to: '2' });
  eq('the lost "5 inch" is restored as the unit size', out[0].unit_size, '5 inch');
  eq('a field that was ABSENT records from:null — not from:""', out[0]._amended.unit_size.from, null);
  ok('⚠️ the input array is NOT mutated — the chit\'s own lines must never change',
     LINES[0].quantity === 5 && LINES[0].unit_size === undefined,
     'apply() wrote through to the caller\'s objects: ' + JSON.stringify(LINES[0]));
  ok('an untouched line is untouched', out[1].quantity === 10 && !out[1]._amended);
}

console.log('\n2 · quantity stays a NUMBER (the DB hands back text)');
{
  const out = amend.apply([{ particulars: 'x', quantity: 5, price: 3 }],
    [{ line_index: 0, field: 'quantity', old_value: '5', new_value: '2' }]);
  ok('typeof quantity === number', typeof out[0].quantity === 'number', 'got ' + typeof out[0].quantity);
  /* ⚠️ THE RED CASE. If new_value came through as the string "2", the total would be "2"*3 → still 6 by JS
     coercion, but a later "+" anywhere downstream would concatenate. Assert the total, then assert the type. */
  eq('the total is recomputed from the corrected quantity', out[0].total, 6);
}

console.log('\n3 · correcting a correction keeps the FIRST reading, not the middle one');
{
  const out = amend.apply(LINES, [
    { line_index: 0, field: 'quantity', old_value: '5', new_value: '2' },
    { line_index: 0, field: 'quantity', old_value: '2', new_value: '3' },
  ]);
  eq('current value is the latest', out[0].quantity, 3);
  eq('struck-through value is what the READER produced, not the intermediate human one',
     out[0]._amended.quantity, { from: '5', to: '3' });
}

console.log('\n4 · an amendment to a line that no longer exists is ignored, never thrown');
{
  let threw = null;
  try { amend.apply(LINES, [{ line_index: 9, field: 'quantity', old_value: '1', new_value: '2' }]); }
  catch (e) { threw = e.message; }
  ok('no throw', threw === null, threw);
}

console.log('\n5 · chit-level amendments (line_index null) land separately');
{
  const r = amend.apply(LINES, [{ line_index: null, field: 'delivery_address', old_value: null, new_value: 'velachery' }], true);
  eq('the address is a chit fact, not a line fact', r.chit.delivery_address, { from: null, to: 'velachery' });
  ok('no line was touched', !r.lines[0]._amended && !r.lines[1]._amended);
}

console.log('\n6 · validation refuses what must not become a record');
(async () => {
  const refuses = async (name, edits, expect) => {
    try { await amend.record('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', edits); }
    catch (e) { return ok(name, e.status === 400 && new RegExp(expect, 'i').test(e.message), 'got: ' + e.status + ' ' + e.message); }
    ok(name, false, 'it was ACCEPTED');
  };
  /* ⚠️ These reject before any DB call, which is why this file needs no database. If that ordering is ever
     changed, this block starts failing with a connection error rather than silently passing — which is correct. */
  await refuses('an unknown field is refused', [{ line_index: 0, field: 'total', old_value: '1', new_value: '2' }], 'cannot amend');
  await refuses('a line-only field is refused at chit level', [{ line_index: null, field: 'quantity', old_value: '1', new_value: '2' }], 'cannot amend');
  await refuses('a chit-only field is refused on a line', [{ line_index: 0, field: 'delivery_address', old_value: null, new_value: 'x' }], 'cannot amend');
  await refuses('an amendment that changes nothing is refused', [{ line_index: 0, field: 'quantity', old_value: '5', new_value: '5' }], 'unchanged');
  await refuses('an empty edit list is refused', [], 'nothing to amend');

  console.log('\n7 · the fields a human may correct');
  ok('particulars/quantity/unit/unit_size/price/comment are all amendable',
     ['particulars', 'quantity', 'unit', 'unit_size', 'price', 'comment'].every((f) => amend.LINE_FIELDS.includes(f)));
  ok('⚠️ `total` is NOT amendable — it is derived; amending it would let the arithmetic disagree with its inputs',
     !amend.LINE_FIELDS.includes('total'));

  console.log('\n────────────────────────────────────────────────────────────────────────────');
  console.log((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
  console.log('⚠️  NOT PROVEN HERE: the INSERT, the RLS policy, the route, the UI. Those need b137 applied\n' +
              '    and a live entity — this file only covers the pure layer.\n');
  process.exit(fail ? 1 : 0);
})();
