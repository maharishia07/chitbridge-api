/**
 * crm-26-sheet-reads-invoice.test.cjs — CRM-26 (proof 2026-11-14, web #15 "web reads the invoice"): the chit popup paints the figures the chit was FROZEN with — read, never worked out.
 * OWNS      the proof, on the real chit-sheet.js moneyFor (lifted into a vm sandbox): the order of what it reads — the frozen invoice (through CBTax.moneyOf, with the chit's currency),
 *           else the header's own summary_json.money, else the order's total_value / indicative_total, else null ("not recorded") — and that it returns what it was given, never a sum.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/crm-26-sheet-reads-invoice.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const asked = [];
const frozen = { total: 118, taxable: 100, tax: 18, from: 'invoice' };
const cx = vm.createContext({ root: { CBTax: { moneyOf: (inv, cur) => { asked.push({ inv, cur }); return frozen; } } } });
vm.runInContext(liftFns('public/app/chit-sheet.js', ['moneyFor'], '  ') + '\nthis.moneyFor = moneyFor;', cx);
const J = (v) => JSON.parse(JSON.stringify(v));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const invoice = { ItemList: [] };
let m = cx.moneyFor({ invoice }, { total: 1 }, 'INR', { total_value: 2 });
ok(m === frozen && asked.length === 1 && asked[0].inv === invoice && asked[0].cur === 'INR', 'a frozen invoice wins over everything else: read through CBTax.moneyOf with the chit\'s own currency, the very object it answered (118, not 1 or 2)');
m = cx.moneyFor({}, { total: 50, tax: 5 }, 'INR', { total_value: 2 });
ok(J(m).total === 50 && J(m).tax === 5, 'no invoice: the header\'s own summary_json.money is shown as stored (total 50, tax 5)');
m = cx.moneyFor({}, {}, 'INR', { total_value: '75.5' });
ok(J(m).total === 75.5 && Object.keys(J(m)).join() === 'total', 'an order not yet billed: the figure it was placed with, total_value "75.5" → total 75.5 and nothing else');
m = cx.moneyFor(null, null, 'INR', { indicative_total: 20 });
ok(J(m).total === 20, 'an indicative total is read when there is no total_value (20)');
ok(cx.moneyFor({}, {}, 'INR', {}) === null && cx.moneyFor(null, null, 'INR', null) === null, 'nothing recorded → null (the popup says "not recorded", never a 0)');
ok(cx.moneyFor({}, null, 'INR', { total_value: 'abc' }) === null, 'an unreadable total_value is null, not NaN and not 0');
const before = asked.length;
ok(cx.moneyFor({ invoice }, null, 'INR', null) === frozen && asked.length === before + 1, 'an invoice with no summary at all is still read from the invoice');
const bare = vm.createContext({ root: {} });
vm.runInContext(liftFns('public/app/chit-sheet.js', ['moneyFor'], '  ') + '\nthis.moneyFor = moneyFor;', bare);
ok(J(bare.moneyFor({ invoice }, { total: 9 }, 'INR', null)).total === 9, 'when the tax engine is not loaded the header\'s summary is used, not a guess');
process.exitCode = bad ? 1 : 0;
