/**
 * crm-23-dues-columns.test.cjs — CRM-23 (proof 2026-11-14): the Dues list has three data columns (Party, Total due, Oldest due) plus the action column — not eight age columns cut off at the edge.
 * OWNS      the proof, on the real cap-books.js bkDuesCols (lifted into a vm sandbox): the column keys and labels in order, the sort key of each data column, the action column pinned at the end,
 *           and what each cell paints for a hand-built party (the age bucket is a words line inside the Oldest due cell, not a column of its own).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/crm-23-dues-columns.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const cx = vm.createContext({
  tx: (s) => s,
  esc: (s) => String(s),
  bkPartyLabel: (id, name) => name,
  bkMoney: (n, c) => 'M' + n + (c ? c : ''),
  bkDate: (d) => 'D' + d,
  bkDuesForeign: () => '',
  bkDuesAdvance: () => false,
  bkDuesAge: (p) => (p.buckets && p.buckets.m6_1y ? '6–12 m' : ''),
  bkDuesActs: () => '<button>Pay</button>',
  bkNeedChips: (p) => (p.needs && p.needs.bills ? '<chips>' : '')
});
vm.runInContext(liftFns('public/app/cap-books.js', ['bkDuesCols']) + '\nthis.bkDuesCols = bkDuesCols;', cx);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const cols = cx.bkDuesCols('INR');
const keys = cols.map((c) => c.key).join(',');
ok(keys === 'party,needs,due,oldest,act', 'the Dues columns are Party, Needs, Total due, Oldest due and the action, in that order (W15-114 added Needs): ' + keys);
ok(JSON.stringify(cols.slice(0, 4).map((c) => c.label)) === JSON.stringify(['Party', 'Needs', 'Total due', 'Oldest due']) && cols[4].label.trim() === '', 'their labels: "Party", "Total due", "Oldest due", and a blank head for the action');
ok(cols.filter((c) => c.key !== 'act').length === 4, 'four data columns: the three of the "max three" rule and the Needs column Athi asked for (W15-114); no eight-bucket age grid');
ok(cols[4].pin === 'end', 'the action column is pinned to the end, so it is never the one cut off at the edge');
ok(cols[0].sort === 'party' && cols[1].sort === 'needs' && cols[2].sort === 'due' && cols[3].sort === 'oldest' && cols[2].num === true, 'the data columns sort by party, due, oldest; the amount is a number column');
const party = { party_id: 'p1', name: 'Ravi Stores', balance_minor: -5000, oldest_due: '2026-01-05', buckets: { m6_1y: 5000 } };
ok(cols[0].cell(party) === 'Ravi Stores', 'Party cell: the name on one line: ' + cols[0].cell(party));
ok(cols[0].cell({ party_id: 'p9', balance_minor: 100 }) === 'Unnamed party', 'a party with no name says "Unnamed party" (never a blank cell)');
ok(/<b data-b="balance">M5000INR<\/b>/.test(cols[2].cell(party)), 'Total due cell: the amount, never signed (−5000 paints 5000): ' + cols[2].cell(party));
ok(cols[1].cell(party) === '' && cols[1].cell(Object.assign({ needs: { bills: 2 } }, party)) === '<chips>', 'Needs cell: empty for a party that needs nothing (no dashes), the chips for one that does');
ok(/D2026-01-05/.test(cols[3].cell(party)) && /6–12 m/.test(cols[3].cell(party)), 'Oldest due cell: the date and the age bucket in words, in one cell: ' + cols[3].cell(party));
ok(/—/.test(cols[3].cell({ party_id: 'p2', name: 'X', balance_minor: 0 })), 'a party with nothing outstanding shows a dash, not a date');
ok(cols[4].cell(party) === '<button>Pay</button>', 'the action cell is the row actions');
process.exitCode = bad ? 1 : 0;
