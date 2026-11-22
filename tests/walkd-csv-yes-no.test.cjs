/**
 * tests/walkd-csv-yes-no.test.cjs — WALK-D D-F-09: THE CSV'S stocked / batch_tracked "yes" / "no" BECOME BOOLEANS AT IMPORT.
 *
 * OWNS      lib/csv-preflight booleanOf + applyDecisions: the walker's file (stocked=yes, batch_tracked=no) stored the TEXT, which lib/stocked boolOf (true/false only) ignores.
 *           Hand figures: yes/Y/TRUE/1 → true; no/n/False/0 → false; "maybe" → left out (never junk); an ordinary text column stays text; the stored flag then reads back through stocked.flagsOfRows.
 * CALLED BY by hand: node tests/walkd-csv-yes-no.test.cjs
 * FLOW      cell → booleanOf → item_data.stocked | .batch_tracked (boolean) → stocked.flagsOfRows
 * CARD      06-catalogue-pim/import-export-workbook-preflight
 */
'use strict';
const assert = require('assert');
const P = require('../lib/csv-preflight');
const { applyDecisions } = require('../lib/csv-decisions');
const CSV = require('../lib/csv');
const stocked = require('../lib/stocked');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('   ok   ' + name); pass++; } catch (e) { console.log('   FAIL ' + name + '\n        ' + e.message); fail++; } };
const tpl = CSV.templateFor({ schema: { properties: { name: {} } }, orderInput: { preset: 'cart', pipeline: 'commerce' } });
const run = (rows) => applyDecisions({
  headers: ['Item', 'Stocked', 'Batch tracked', 'Note'], rows, template: tpl,
  decisions: [{ incoming: 'Item', action: 'map', field: 'name' }, { incoming: 'Stocked', action: 'create', field: 'stocked' }, { incoming: 'Batch tracked', action: 'create', field: 'batch_tracked' }, { incoming: 'Note', action: 'create', field: 'note' }]
});

console.log('\n== WALK-D D-F-09 · yes / no cells become booleans ==\n');
t('the walker\'s row: stocked=yes, batch_tracked=no → true, false (not "yes", "no")', () => {
  const out = run([['WKD Yoghurt', 'yes', 'no', 'cold shelf']]);
  assert.strictEqual(out.items[0].stocked, true);
  assert.strictEqual(out.items[0].batch_tracked, false);
  assert.strictEqual(out.items[0].note, 'cold shelf', 'an ordinary column stays text');
});
t('every spelling: Y / TRUE / 1 → true; n / False / 0 → false', () => {
  const out = run([['A', 'Y', 'n', ''], ['B', 'TRUE', 'False', ''], ['C', '1', '0', '']]);
  assert.deepStrictEqual(out.items.map((i) => [i.stocked, i.batch_tracked]), [[true, false], [true, false], [true, false]]);
});
t('a cell that says neither is left out, never stored as junk; the item keeps its default', () => {
  const out = run([['D', 'maybe', 'sometimes', '']]);
  assert.ok(!('stocked' in out.items[0]) && !('batch_tracked' in out.items[0]));
});
t('the stored flag is honoured by the reader (lib/stocked.flagsOfRows: undefined for text, the boolean for a boolean)', () => {
  const flags = stocked.flagsOfRows([{ item_id: 'x', stocked: 'yes', batch_tracked: 'no' }, { item_id: 'y', stocked: true, batch_tracked: false }]);
  assert.deepStrictEqual(flags.get('x'), { batch_tracked: undefined, stocked: undefined });
  assert.deepStrictEqual(flags.get('y'), { batch_tracked: false, stocked: true });
});
console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
