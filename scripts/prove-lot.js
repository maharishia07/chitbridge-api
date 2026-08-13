'use strict';
/**
 * prove-lot.js — the INSTANCE, kept off the product.
 *
 * Athi, 2026-08-13: *"what about batch number, exp date — where does it count? Also the same product price
 * movement, how do we manage two or three of the same SKU?"*
 *
 * ⚠️ THE DEFECT THIS EXISTS FOR: `batch_no` and `expiry` were CATALOGUE ITEM fields in the pharma starter set, and
 * the CSV importer allows `batch_no` as the identity key. Follow that through and every new consignment becomes a
 * new catalogue row — a thousand lots a year is a thousand products a year, each carrying its own version history.
 * The catalogue becomes a lot ledger, which is exactly the unbounded growth b146 exists to prevent.
 *
 * Run: node scripts/prove-lot.js
 */
const gs1 = require('../lib/gs1');
const amend = require('../lib/amend');
const starter = require('../lib/starter-fields');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? '\n      ' + d : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), 'got  ' + JSON.stringify(g) + '\n      want ' + JSON.stringify(w));

console.log('\n── lot / instance identity ──────────────────────────────────────────────────\n');

console.log('1 · ⭐ THE PRODUCT IS THE CLASS, THE LOT IS THE INSTANCE');
{
  eq('a batch and an expiry normalise to the GS1 shape',
    gs1.lotOf({ batch: '24B', expiry: '2027-03-01' }), { batch: '24B', expiry: '2027-03-01' });
  eq('`batch_no` is accepted as an alias — it is what every delivery note says',
    gs1.lotOf({ batch_no: 'L-9' }), { batch: 'L-9' });
  /* ⚠️ An empty object is not an empty lot. "Tracked, and the lot is unknown" is a far more alarming claim than
     "this product is not lot-tracked", and only one of them is usually true. */
  ok('⚠️ nothing stated → null, NOT {} — an empty lot would claim "tracked but unknown"', gs1.lotOf({}) === null);
  ok('a bare string is not a lot', gs1.lotOf('24B') === null);
  /* ⚠️ An expiry wrong by nine months is worse than one that is absent: absent gets asked about. */
  eq('⚠️ an ambiguous date is DROPPED, never guessed — 12/03/25 is March or December',
    gs1.lotOf({ batch: 'X', expiry: '12/03/25' }), { batch: 'X' });
}

console.log('\n2 · ⭐ TWO OR THREE OF THE SAME SKU ARE ONE PRODUCT, THREE LOTS');
{
  const sku = { sku: 'MED-01' };
  const a = gs1.lotKey(sku, { batch: '24A' });
  const b = gs1.lotKey(sku, { batch: '24B' });
  ok('the same SKU in two consignments gives two distinct keys', a && b && a !== b, a + ' / ' + b);
  eq('…and the SKU is still one SKU', [a.split('|')[0], b.split('|')[0]], ['med-01', 'med-01']);
  /* ⚠️ A batch number is only unique WITHIN a product. "24B" from two manufacturers is two unrelated
     consignments, and a recall matching the batch alone would sweep in a stranger's stock. */
  ok('⚠️ a batch with no product is NOT an identity — "24B" alone belongs to everyone',
    gs1.lotKey({}, { batch: '24B' }) === null);
  ok('a serial narrows it to one unit', gs1.lotKey(sku, { serial: 'SN-7' }) === 'med-01|sn-7');
}

console.log('\n3 · FEFO — why expiry is not just another date');
{
  /* ⚠️ FIFO ships the wrong box when a later delivery carries an older date. Odoo names the fix FEFO. */
  ok('an expiry in the past reads as expired', gs1.expiryState({ batch: 'x', expiry: '2020-01-01' }) === 'expired');
  ok('a far expiry is fine', gs1.expiryState({ batch: 'x', expiry: '2099-01-01' }) === 'fine');
  ok('⚠️ no expiry is "unknown", never "fine" — an untracked date must not read as a safe one',
    gs1.expiryState({ batch: 'x' }) === 'unknown');
}

console.log('\n4 · ⭐ THE LOT TRAVELS ON THE LINE, AND SURVIVES THE AMEND PATH');
{
  const l = amend.clean({ particulars: 'Paracetamol 500', quantity: 100, lot: { batch: '24B', expiry: '2027-03-01', junk: 'x' } });
  eq('a person can record the lot on a correction', l.lot, { batch: '24B', expiry: '2027-03-01' });
  ok('…and unknown keys inside it are dropped', !('junk' in l.lot));
  ok('an empty lot leaves no lot key at all', !('lot' in amend.clean({ particulars: 'X', lot: {} })));
  /* clean() String()s every whitelisted field; a lot arriving through that loop would store as "[object Object]". */
  ok('⚠️ the lot is NOT mangled by the string coercion that destroys unknown object fields',
    typeof amend.clean({ particulars: 'X', lot: { batch: 'B1' } }).lot === 'object');
}

console.log('\n5 · ⚠️ THE CATALOGUE MUST NOT CARRY A CONSIGNMENT');
{
  const pharma = starter.starterFor('pharma');
  const keys = (pharma.fields || []).map((f) => f.field_key);
  ok('⭐ `batch_no` is NO LONGER a catalogue field — it was, and it made a product per lot',
    !keys.includes('batch_no'), keys.join(', '));
  ok('⭐ `expiry` is no longer one either', !keys.includes('expiry'), keys.join(', '));
  /* What DOES belong on the product: facts true of every unit ever made. */
  ok('the product declares whether it is tracked at all (Odoo model)', keys.includes('tracking'));
  ok('…and its shelf life, which is a property of the product', keys.includes('shelf_life_days'));
  ok('the clinical facts stay — they are true of every unit', keys.includes('active_ingredient'));
}

console.log('\n6 · the barcode boundary');
{
  /* ⚠️ We store ISO and convert at the wire. GS1 dates are YYMMDD: unreadable in a database, ambiguous past 2049,
     and unsortable against everything else we hold. The standard governs the wire format, not our storage. */
  eq('GTIN + batch + expiry render as a GS1 element string',
    gs1.toElementString('05012345678900', { batch: '24B', expiry: '2027-03-01' }),
    '(01)05012345678900(10)24B(17)270301');
  ok('an invalid GTIN is simply not emitted — a bad check digit is not a barcode',
    (gs1.toElementString('05012345678901', { batch: '24B' }) || '').indexOf('(01)') === -1);
}

console.log('\n────────────────────────────────────────────────────────────────────────────');
console.log((fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
