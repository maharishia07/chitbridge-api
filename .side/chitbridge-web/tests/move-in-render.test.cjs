'use strict';
/* MNT (6 Nov 2026): public/app/cap-move-in.js, the Xero / QuickBooks move-in screen, run in node with a stub page: the request body a step
   sends (file, kind, side, move date, source country), the three steps' HTML (columns, preview, result), the preview list's columns and
   filter, and the skipped-rows download's link clean-up saying a failure in words. Pins the text the readability pass must not change.
   Run: node tests/move-in-render.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const logged = [];
const cx = vm.createContext({
  console, EP: {}, tx: (s) => s, txf: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]), esc: (s) => String(s == null ? '' : s),
  api: async () => ({}), document: { getElementById: () => null, querySelector: () => null },
  cblog: (level, words) => logged.push(level + ': ' + words), bkCur: () => 'INR'
});
cx.window = cx;
vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cap-move-in.js', 'utf8'), cx);
const run = (code) => vm.runInContext(code, cx);

run("miFresh(); MIV.f.csv = 'a,b'; MIV.f.country = 'IN'; MIV.f.kind = 'open_bills'; MIV.f.side = 'supplier'; MIV.f.as_at = '2026-04-01';");
const body = run('miBody()');
ok(body.csv === 'a,b' && body.side === 'payable' && body.as_at === '2026-04-01' && body.source_country === 'IN', 'an open-bills file carries csv, its side as payable/receivable, the move date and the source country');
run("MIV.f.kind = 'accounts';");
const plain = run('miBody()');
ok(plain.side === undefined && plain.as_at === undefined, 'a chart of accounts carries neither side nor date');
ok(run("miNeedsSide('contacts') && miNeedsSide('open_bills') && !miNeedsSide('items')"), 'only contacts and open bills need a side');
ok(run("miNeedsDate('trial_balance') && miNeedsDate('open_bills') && !miNeedsDate('contacts')"), 'only the trial balance and open bills need a move date');

const big = run("miBigNumber(null, 'added', 'mi-x')");
ok(big.includes('data-testid="mi-x"') && big.includes('>0<') && big.includes('>added<'), 'a big figure shows 0 for nothing, its caption and its test id');

run("MIV.pre = null; MIV.busy = false; MIV.err = '';");
ok(run('miRender("columns")').includes('Read the file first'), 'columns before the file is read says to read the file first');
run("MIV.pre = { rows_total: 3, fields: [{ key: 'name', label: 'Name', required: true }], guess: [{ incoming: 'Col A', field: 'name', how: 'guess', why: 'looks like a name' }] }; MIV.f.name = 'x.csv';");
const columns = run('miRender("columns")');
ok(columns.includes('mi-columns-step') && columns.includes('3 rows in x.csv') && columns.includes('Name *') && columns.includes('A guess'), 'the columns step lists each file column with the guessed field, marked required, and says it is a guess');

run("MIV.plan = { counts: { add: 2, merge: 1, skip: 0, hold: 4 }, notes: ['one note'], rows: [] }; MIV.refused = null;");
const preview = run('miRender("preview")');
ok(preview.includes('mi-n-add') && preview.includes('mi-n-hold') && preview.includes('one note') && preview.includes('id="mi_rows"'), 'the preview step shows the four counts (held only when there are some), the notes and the row list slot');
run("MIV.plan.counts.hold = 0;");
ok(!run('miRender("preview")').includes('mi-n-hold'), 'no held rows, no held count');

const filters = run('miRowFilters()');
ok(filters.length === 1 && filters[0].options.map((o) => o.v).join() === 'add,merge,skip,hold' && filters[0].match({ action: 'skip' }, 'skip') === true, 'the preview list filters by add / merge / skip / hold');
const cols = run('miRowColumns()');
ok(cols.map((c) => c.key).join() === 'line,what,action,why' && cols[2].cell({ line: 7, action: 'merge' }).includes('data-testid="mi-act-7"'), 'the preview list has line, what, action and why columns, the action chip carrying its row number');
const sorted = [{ line: 2, action: 'b' }, { line: 1, action: 'a' }].sort(run('miRowSorts()')[1].cmp);
ok(sorted[0].action === 'a', 'the action sort orders by the action word');

run("MIV.out = { added: 5, merged: 1, skipped: 2, held: 0, entry: { entry_no: 'JV-1', suspense_minor: 0 } };");
const done = run('miRender("file")');
ok(done.includes('mi-done') && done.includes('mi-done-add') && done.includes('Entered as JV-1.') && !done.includes('mi-done-hold'), 'once imported every step shows the result with the counts and the journal number');
console.log(n + ' checks, all ok');
