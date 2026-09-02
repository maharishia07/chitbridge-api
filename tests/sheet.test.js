'use strict';
/**
 * sheet.test.js — a spreadsheet carries ANSWERS, not RECORDS.
 *
 * Athi, 2026-09-02: *"json is too much for the user and he will not understand… for the user, availability yes or
 * no is only matter, internally we need to set when and who"*, *"otherwise split the field and provide as 3
 * fields but not as a json for sure"*, and *"availability and qty should be stamped new even if the status or
 * value didn't change."*
 *
 * Those three sentences are the three groups below.
 */
const assert = require('assert');
const S = require('../lib/sheet');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}

const ITEM = {
  name: 'Tea, 250g', unit: 'packet', price: { amount: 180, currency: 'INR' },
  status: 'available',
  avail: { qty: 12, source: 'manual', as_of: '2026-09-01T04:11:07.221Z' },
  categories: ['9c33-aaa', '7b21-bbb'], category_names: ['Beverages', 'Dry goods'],
  synonyms: ['chai'], commercials: { price: 190 },
};

console.log('\nsheet · nothing a person opens is JSON');

t('⭐ NO VALUE IN THE ROW IS AN OBJECT, except money (which csv splits itself)', () => {
  const row = S.toSheet(ITEM);
  for (const [k, v] of Object.entries(row)) {
    if (k === 'price') continue;                       // csv.valueFor splits this into price + price_currency
    assert.ok(typeof v !== 'object' || v === null, k + ' is an object and would be JSON in a cell: ' + JSON.stringify(v));
  }
});

t('the availability record never reaches the sheet in its stored form', () => {
  const row = S.toSheet(ITEM);
  assert.strictEqual(row.avail, undefined);
  assert.strictEqual(row.status, undefined);
});

t('category IDs never reach the sheet; the names do, readably', () => {
  const row = S.toSheet(ITEM);
  assert.strictEqual(row.categories, 'Beverages, Dry goods');
});

t('matcher hints and an adopter overlay are the system\'s, not the merchant\'s', () => {
  const row = S.toSheet(ITEM);
  assert.strictEqual(row.synonyms, undefined);
  assert.strictEqual(row.commercials, undefined);
});

console.log('\nsheet · split into flat columns, never nested');

t('⭐ availability becomes three plain columns — the same shape money has always used', () => {
  const row = S.toSheet(ITEM);
  assert.strictEqual(row.available, 'yes');
  assert.strictEqual(row.qty, 12);
  assert.strictEqual(row.qty_as_of, '2026-09-01');     // a date a person reads, not a machine timestamp
  assert.strictEqual(row.qty_source, 'manual');
});

t('a merchant\'s own columns pass through untouched', () => {
  const row = S.toSheet(Object.assign({}, ITEM, { grade: 'A', hs_code: '0902' }));
  assert.strictEqual(row.grade, 'A');
  assert.strictEqual(row.hs_code, '0902');
});

t('three of the four statuses mean one thing to a buyer', () => {
  for (const s of ['unavailable', 'redundant', 'retired']) {
    assert.strictEqual(S.toSheet({ status: s }).available, 'no', s + ' should read as no');
  }
  assert.strictEqual(S.toSheet({ status: 'available' }).available, 'yes');
});

console.log('\nsheet · the stamp refreshes even when nothing changed');

t('⭐⭐ the SAME yes and the SAME qty, uploaded again, gets a NEW as_of', () => {
  const first  = S.fromSheet({ available: 'yes', qty: 12 }, { now: '2026-09-01T00:00:00.000Z' });
  const second = S.fromSheet({ available: 'yes', qty: 12 }, { now: '2026-09-02T00:00:00.000Z' });
  assert.strictEqual(first.item_data.avail.qty, second.item_data.avail.qty, 'the value did not change');
  assert.notStrictEqual(first.item_data.avail.as_of, second.item_data.avail.as_of,
    'the as-of MUST move — a re-upload is a fresh confirmation, not a no-op');
  assert.strictEqual(second.item_data.avail.as_of, '2026-09-02T00:00:00.000Z');
});

t('⚠️ the stamp columns are OUTPUT ONLY — a merchant cannot backdate their own stock', () => {
  const r = S.fromSheet({ available: 'yes', qty: 5, qty_as_of: '1999-01-01', qty_source: 'invented' },
    { now: '2026-09-02T00:00:00.000Z' });
  assert.strictEqual(r.item_data.avail.as_of, '2026-09-02T00:00:00.000Z');
  assert.strictEqual(r.item_data.avail.source, 'upload');
});

t('yes/no is read the way people actually write it', () => {
  for (const y of ['yes', 'Y', 'TRUE', '1', 'in stock', 'Available']) assert.strictEqual(S.readYesNo(y), 'yes', y);
  for (const n of ['no', 'N', 'false', '0', 'out of stock', 'Unavailable']) assert.strictEqual(S.readYesNo(n), 'no', n);
});

t('⚠️ AN EMPTY CELL SAYS NOTHING — a partial upload must not retire half a catalogue', () => {
  const r = S.fromSheet({ name: 'Tea', available: '' }, { now: '2026-09-02T00:00:00.000Z' });
  assert.strictEqual(r.item_data.status, undefined, 'blank is not "no"');
  assert.strictEqual(r.item_data.avail, undefined, 'blank must not stamp an empty record');
});

t('⚠️ a blank qty is not zero', () => {
  const r = S.fromSheet({ available: 'yes', qty: '' }, { now: '2026-09-02T00:00:00.000Z' });
  assert.strictEqual(r.item_data.avail.qty, undefined, 'absent is not zero — availability.countedZero draws the same line');
  assert.strictEqual(r.item_data.avail.as_of, '2026-09-02T00:00:00.000Z', 'but saying "yes" still records WHEN');
});

t('a sheet can never set a record directly', () => {
  const r = S.fromSheet({ name: 'Tea', avail: { qty: 999 }, status: 'available', categories: ['x'], item_id: 'z' },
    { now: '2026-09-02T00:00:00.000Z' });
  assert.strictEqual(r.item_data.item_id, undefined);
  assert.deepStrictEqual(r.item_data.avail, undefined, 'the raw record is not settable from a cell');
});

t('a round trip keeps what the merchant maintains', () => {
  const row = S.toSheet(ITEM);
  const back = S.fromSheet(row, { now: '2026-09-02T00:00:00.000Z' });
  assert.strictEqual(back.item_data.name, 'Tea, 250g');
  assert.strictEqual(back.item_data.unit, 'packet');
  assert.strictEqual(back.item_data.status, 'available');
  assert.strictEqual(back.item_data.avail.qty, 12);
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
