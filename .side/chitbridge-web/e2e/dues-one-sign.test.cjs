/**
 * dues-one-sign.test.cjs — l16 integ2b-finmsg (16 Nov 2026): what you owe a supplier reads the SAME on Dues, CRM and the balance sheet — a positive amount, with the side in words.
 * OWNS      the proof, on the real functions (vm sandbox): bkMoney · bkOwes · bkDuesCols (Total due) · crmDueCell · the supplier-owes-us (advance) case · bkHeldBy
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 *   node e2e/dues-one-sign.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');
const cx = vm.createContext({
  tx: (s) => s, txf: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k]), esc: (s) => String(s), bkDate: (d) => '16 Nov 2026',
  CBUiMoney: { currency: () => 'AUD', decimals: () => 2 },
  fmtMoney: (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  bkNeedChips: () => '', bkDuesNext: () => '', bkDuesAge: () => '', bkOwedFlags: () => '', CRM: { ledger: true, currency: 'AUD' },
  bkPartyLabel: (id, n) => n, bkBillNo: () => '', bkNoWrap: (s) => s, bkDuesPaid: () => ''
});
vm.runInContext(
  liftFns('public/app/cap-books.js', ['bkCur', 'bkDec', 'bkMoney', 'bkOwes', 'bkDuesSide', 'bkDuesAdvance', 'bkDuesForeign', 'bkDuesCols', 'bkHeldBy']) + '\n' +
  liftFns('public/app/cap-crm.js', ['crmNothingDueCell', 'crmDueCell']) +
  '\nthis.f = { bkMoney, bkOwes, bkDuesCols, crmDueCell, bkHeldBy };', cx);
const f = cx.f;
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const supplier = { party_id: 'p1', name: 'Jones Plumbing Supplies', side: 'supplier', balance_minor: -253000 }; /* the server's figure: Dr − Cr, so you owe = negative */
const balanceSheetPayables = f.bkMoney(253000, 'AUD'); /* the balance sheet / TB carry payables as the plain amount */
const dueCell = f.bkDuesCols('AUD').find((c) => c.key === 'due').cell(supplier);
const crmCell = f.crmDueCell(supplier);
ok(balanceSheetPayables === '2,530.00', 'balance sheet payables read 2,530.00');
ok(/2,530\.00/.test(dueCell) && !/-\s*2,530|−/.test(dueCell), 'Dues "Total due" reads 2,530.00, no minus: ' + dueCell);
ok(/2,530\.00/.test(crmCell) && /you'll give/.test(crmCell) && !/-\s*2,530|−/.test(crmCell), 'CRM reads 2,530.00 you\'ll give, no minus');
ok(f.bkOwes(-253000, 'AUD') === 'you owe 2,530.00', 'the Dues "To pay" head says: ' + f.bkOwes(-253000, 'AUD'));
ok(dueCell.indexOf(balanceSheetPayables) >= 0 && crmCell.indexOf(balanceSheetPayables) >= 0, 'Dues, CRM and the balance sheet carry the same text 2,530.00');

const advance = { party_id: 'p2', name: 'Bean Co', side: 'supplier', balance_minor: 55000 }; /* a supplier we paid ahead: THEY owe us */
const advDue = f.bkDuesCols('AUD').find((c) => c.key === 'due').cell(advance);
ok(/advance paid — they owe you/.test(advDue) && !/to pay/i.test(advDue), 'a supplier debit balance reads "they owe you", not "to pay"');
ok(/you'll get/.test(f.crmDueCell(advance)) && /they owe you 550\.00/.test(f.bkOwes(55000, 'AUD')), 'CRM and the head say they owe you 550.00');

ok(f.bkHeldBy({ by_name: 'Priya (auditor)', at: '2026-11-15' }) === 'Held by Priya (auditor) on 16 Nov 2026. Ask them to release it.', 'a hold names who and when');
ok(!/attached/.test(f.bkHeldBy({})) && /^Held by someone else\./.test(f.bkHeldBy({})), 'no attachment claimed; no name -> "someone else"');
if (bad) { console.log(bad + ' FAILED'); process.exit(1); }
console.log('all ok');
