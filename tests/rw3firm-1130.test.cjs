/* tests/rw3firm-1130.test.cjs — RW3-22: the trial balance files each account under the statements' own line (one grouping, read by the P&L, the balance sheet and the TB).
 * HAND-COMPUTED  AU pack: Wages 6015 → "Employee benefits expense"; Bank and merchant fees 6090 → "Finance costs"; Rent 6010 → "Other expenses"; Bank 1500 → "Cash and cash equivalents";
 *                Sales 4000 → "Revenue"; an unknown code 9999 under group retired_stuff → "Retired stuff" (the group's key as words). Every label starts with a capital and has no underscore.
 * OWNS the guard of withGroupLabels (lib/books-report-period.js).   Run: node tests/rw3firm-1130.test.cjs   CARD 14-accounting */
'use strict';
const assert = require('assert');
const R = require('../lib/books-report-period');
const pack = require('../lib/regulation').resolve({ country: 'AU' });
const rows = [['6015', 'operating_expenses'], ['6090', 'operating_expenses'], ['6010', 'operating_expenses'], ['1500', 'bank_accounts'], ['4000', 'sales'], ['9999', 'retired_stuff']].map(([code, group]) => ({ code, group, debit_minor: 1, credit_minor: 0 }));
const got = R.withGroupLabels(rows, pack).map((row) => row.group_label);
assert.deepStrictEqual(got, ['Employee benefits expense', 'Finance costs', 'Other expenses', 'Cash and cash equivalents', 'Revenue', 'Retired stuff']);
assert.ok(got.every((label) => /^[A-Z]/.test(label) && !label.includes('_')));
assert.deepStrictEqual(R.withGroupLabels(rows, pack).map((row) => row.group), rows.map((row) => row.group)); /* the chart key stays */
console.log('  ok   6 checks');
