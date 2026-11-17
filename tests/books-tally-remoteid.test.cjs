'use strict';
/** tests/books-tally-remoteid.test.cjs — PRICE-FIX F4: every pack voucher carries a stable REMOTEID (the entry_id), so a second import alters, not duplicates. */
const bt = require('../lib/books-tally');
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
const inp = () => ({ dec: (m) => (m / 100).toFixed(2),
  accounts: [{ code: '1000', name: 'Cash', tally_group: 'Cash-in-Hand', role: 'cash' }, { code: '4000', name: 'Sales', tally_group: 'Sales Accounts', role: 'sales' }],
  parties: [], items: [],
  entries: [{ entry_id: 'e-111', entry_no: 'JE-1', posting_date: '2026-10-01', event_type: 'sale_bill', narration: 'x', lines: [{ code: '1000', dr_minor: 100 }, { code: '4000', cr_minor: 100 }] },
            { entry_id: 'e-222', entry_no: 'JE-2', posting_date: '2026-10-02', event_type: 'sale_bill', narration: 'y', lines: [{ code: '1000', dr_minor: 200 }, { code: '4000', cr_minor: 200 }] }] });
const a = bt.build(inp()).files.find((f) => f.name === 'tally-vouchers.xml').data;
const b = bt.build(inp()).files.find((f) => f.name === 'tally-vouchers.xml').data;
t('voucher 1 carries REMOTEID of its entry', /REMOTEID="e-111"/.test(a));
t('voucher 2 carries its own REMOTEID', /REMOTEID="e-222"/.test(a));
t('a rebuilt pack is byte-identical (stable keys)', a === b);
t('one REMOTEID per voucher', (a.match(/REMOTEID=/g) || []).length === 2);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
