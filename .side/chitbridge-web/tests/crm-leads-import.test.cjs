'use strict';
/* MNT (6 Nov 2026): public/app/cap-crm-leads.js, the Leads tab and Import from a CSV, run in node with a stub page: the CSV reader
   (quotes, doubled quotes, newlines inside quotes, CRLF, a BOM, blank lines), the column guess from the header words, the body sent to the
   api (only mapped columns, trimmed, empty cells left out), the counts line, and the lead list's stage filter, orders and import columns.
   Pins the text the readability pass must not change. Run: node tests/crm-leads-import.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const cx = vm.createContext({
  console, tx: (s) => s, esc: (s) => String(s == null ? '' : s), CRM_STAGE: { lead: 'Lead', demo: 'Demo', trial: 'Trial', parked: 'Parked', lost: 'Lost' },
  crmPlural: (count, one, many) => count + ' ' + (count === 1 ? one : many), document: { getElementById: () => null, querySelector: () => null }
});
cx.window = cx;
vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cap-crm-leads.js', 'utf8'), cx);
const run = (code) => vm.runInContext(code, cx);
const json = (code) => JSON.stringify(run(code));


const csv = (text) => JSON.stringify(cx.crmCsvRows(text));
ok(csv('a,b\r\n1,2\r\n\r\n3,4') === '[["a","b"],["1","2"],["3","4"]]', 'CRLF rows are read and the blank line is dropped');
ok(csv('name,note\n"Sam, Jr","said ""hi"""\n"two\nlines",x') === JSON.stringify([['name', 'note'], ['Sam, Jr', 'said "hi"'], ['two\nlines', 'x']]), 'quotes hold commas, doubled quotes and newlines');
ok(csv('﻿a,b\n1,2') === '[["a","b"],["1","2"]]', 'a byte-order mark is dropped');
ok(csv('') === '[]', 'an empty file has no rows');

ok(json("crmImportGuess(['Full Name', 'Mobile Number', 'E-mail', 'Company', 'Town', 'junk'])") === '{"name":0,"phone":1,"email":2,"business":3,"city":4}', 'header words are guessed to name, phone, email, business and city; an unknown column is left out');
ok(json("crmImportGuess(['name', 'name'])") === '{"name":0}', 'a column is used for one field only');

run("LIMP.rows = [['Sam ', '98', '', 'x'], ['Ann', '', 'a@b.c', 'y']]; LIMP.map = { name: 0, phone: 1, email: 2 };");
ok(json('crmImportBody()') === '[{"name":"Sam","phone":"98"},{"name":"Ann","email":"a@b.c"}]', 'only mapped columns go to the api, trimmed, empty cells left out');

const filter = run('crmLeadFilters()')[0];
ok(filter.options.map((o) => o.v).join() === 'lead,demo,trial,parked,lost' && filter.match({ lead: { stage: 'demo' } }, 'demo') && !filter.match({}, 'demo'), 'the stage filter lists the five stages and matches a lead by stage');
const sorts = run('crmLeadSorts()');
const rows = [{ display_name: 'bob', next_followup_at: '2026-12-01' }, { display_name: 'Amy' }, { display_name: 'cat', next_followup_at: '2026-11-01' }];
ok(rows.slice().sort(sorts[0].cmp).map((r) => r.display_name).join() === 'Amy,bob,cat', 'sorted by name, case-blind');
ok(rows.slice().sort(sorts[1].cmp).map((r) => r.display_name).join() === 'cat,bob,Amy', 'sorted by next follow-up, none last');

const previewCols = run('crmImportColumns(true)').map((c) => c.key).join();
const skippedCols = run('crmImportColumns(false)').map((c) => c.key).join();
ok(previewCols === 'name,will,why,row,phone' && skippedCols === 'name,why,row,phone', 'the preview list has a Will column, the skipped list does not');
ok(run('crmImportColumns(true)')[1].cell({ outcome: 'merge' }).includes('Will merge'), 'the Will chip says what the import does with the row');
console.log(n + ' checks, all ok');
