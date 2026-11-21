// tests/in-f08-gstr3b-setoff.test.cjs — IN-F-08: the GSTR-3B read carries the month's set-off preview (_cb.setoff), the engine's own gstSetOff in CGST Act s.49(5) order.  node tests/in-f08-gstr3b-setoff.test.cjs
// Hand figures (the walk's shop P, Nov 2026): sales CGST 228.81 + SGST 228.81; purchases IGST credit 898.20.
//   IGST credit pays CGST 228.81, then SGST 228.81 -> to pay 0.00 on each head, IGST kept 898.20 - 457.62 = 440.58.
// Second case (s.49(5): CGST credit may also meet IGST, after CGST): sales IGST 100.00, CGST 50.00; credit IGST 30.00, CGST 80.00 -> IGST credit 30.00 against IGST (70.00 left),
//   CGST credit 80.00: 50.00 against CGST, the remaining 30.00 against IGST -> IGST to pay 70.00 - 30.00 = 40.00, nothing kept.
const assert = require('assert');
const T = require('../lib/tax-lines');
const zero = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const me = { Gstin: '33ABCPK1234L1ZZ', Country: 'IN' };
let n = 0;
const eq = (got, want, what) => { assert.deepStrictEqual(got, want, what + ' - got ' + JSON.stringify(got)); n++; };

const a = T.gstr3b({ output: Object.assign(zero(), { taxable: 2542.38, cgst: 228.81, sgst: 228.81 }), itc: Object.assign(zero(), { igst: 898.2 }), net: {} }, me, '112026')._cb.setoff;
eq(a.payable, { cgst: 0, sgst: 0, igst: 0 }, 'nothing to pay');
eq(a.carried, { cgst: 0, sgst: 0, igst: 440.58 }, 'IGST credit 440.58 kept');
eq(a.utilised.map((u) => u.from + '>' + u.against + ':' + u.amount), ['igst>cgst:228.81', 'igst>sgst:228.81'], 'IGST first against CGST, then SGST');
eq(a.pay_total, 0, 'pay total 0');

const b = T.gstr3b({ output: Object.assign(zero(), { taxable: 1000, igst: 100, cgst: 50 }), itc: Object.assign(zero(), { igst: 30, cgst: 80 }), net: {} }, me, '112026')._cb.setoff;
eq(b.payable, { cgst: 0, sgst: 0, igst: 40 }, 'IGST 100 less IGST credit 30 less spare CGST credit 30 = 40 to pay; CGST covered');
eq(b.carried, { cgst: 0, sgst: 0, igst: 0 }, 'all credit used');
eq(b.pay_total, 40, 'pay total 40');
console.log(n + ' checks');
