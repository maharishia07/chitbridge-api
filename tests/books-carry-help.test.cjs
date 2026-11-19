#!/usr/bin/env node
// @type: unit
/**
 * books-carry-help.test.cjs — the carry chain covers every fiscal year, and an opening replace knows what a bill's allocations have settled.
 *
 * OWNS      the proof that lib/books-carry-help.js contiguousYears lists every year from the oldest to the newest (an empty year included), and settledOf counts allocations net of their reversals, never a receipt on account, and drops a bill with nothing settled.
 * CALLED BY .github/workflows/ci.yml (offline tests loop). No database, no network: stand-in packs and hand-made engine rows.
 * FLOW      stand-in packs · engine rows → contiguousYears / settledOf → the years · { ref: settled_minor }
 * CARD      16-finance/receivables-and-payables
 * UNIT      16/Opening balances
 * MUTATION  checked once: in lib/books-carry-help.js make contiguousYears return `years` → "an empty year in the middle is still on the chain" fails.
 */
'use strict';
const assert = require('assert');
const { contiguousYears, settledOf } = require('../lib/books-carry-help');

const packs = { fyRange: (year) => ({ start: year + '-01-01', end: year + '-12-31' }), fiscalYearOf: (day) => day.slice(0, 4) };
assert.deepStrictEqual(contiguousYears(packs, {}, []), [], 'no rows, no years: the chain stays closed');
assert.deepStrictEqual(contiguousYears(packs, {}, ['2024']), ['2024'], 'one year is the chain');
assert.deepStrictEqual(contiguousYears(packs, {}, ['2022', '2025']), ['2022', '2023', '2024', '2025'], 'an empty year in the middle is still on the chain');

const rows = [
  { ref_kind: 'allocation', against_ref: 'B1', amount_minor: -500 },
  { ref_kind: 'allocation', against_ref: 'B2', amount_minor: -300 },
  { ref_kind: 'reversal', reverses_kind: 'allocation', against_ref: 'B2', amount_minor: 300 },
  { ref_kind: 'receipt', against_ref: 'B3', amount_minor: -900 },
  null
];
assert.deepStrictEqual({ ...settledOf(rows) }, { B1: 500 }, 'settled = allocations net of reversals; a receipt on account and a fully reversed bill are not there');
assert.deepStrictEqual({ ...settledOf(null) }, {}, 'a missing list answers none, never a throw');
console.log('books-carry-help: 5 checks');
