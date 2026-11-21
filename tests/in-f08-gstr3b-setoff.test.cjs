// tests/in-f08-gstr3b-setoff.test.cjs — IN-F-08: the GSTR-3B read carries the month's set-off preview (_cb.setoff), the engine's own gstSetOff in CGST Act s.49(5) order,
// fed by the ONE builder's figures (batch 1128: the GSTR-3B is built from the ledger's documents, so this test gives it documents).  node tests/in-f08-gstr3b-setoff.test.cjs
// Hand figures (the walk's shop P, Sep 2026): a sale 2,542.38 at 18% inside the state -> CGST 228.81 + SGST 228.81; a purchase 4,990.00 at 18% from another state -> IGST credit 898.20.
//   IGST credit pays CGST 228.81, then SGST 228.81 -> to pay 0.00 on each head, IGST kept 898.20 - 457.62 = 440.58.
const assert = require('assert');
const TL = require('../lib/tax-lines');
const ME = { Gstin: '29AAAAA0000A1Z5', LglNm: 'P Traders', State: '29', Pos: '29', Country: 'IN', RegType: 'regular' };
const OTHER = { Gstin: '33BBBBB1111B1Z2', LglNm: 'Chennai Supplier', State: '33', Country: 'IN', RegType: 'regular' };
const CUSTOMER = { LglNm: 'Walk-in', State: '29', Country: 'IN', RegType: 'unregistered' };
let n = 0;
const eq = (got, want, what) => { assert.deepStrictEqual(got, want, what + ' - got ' + JSON.stringify(got)); n++; };
const sale = (() => {
  const made = TL.invoiceFor({ lines: [{ particulars: 'Goods', quantity: 1, price: 2542.38, hsn: '0902', gst_rate: 18 }], seller: ME, buyer: CUSTOMER, currency: 'INR', chit_id: 's1', at: '2026-09-10' });
  return { chit_id: 's1', direction: 'sent', sells: true, purpose: 'invoice', invoice: made.invoice, provisional: false, seller: Object.assign({ entity_id: 'me' }, ME), buyer: Object.assign({ entity_id: 'c1' }, CUSTOMER), at: '2026-09-10T05:00:00Z' };
})();
const buy = (() => {
  const made = TL.invoiceFor({ lines: [{ particulars: 'Stock', quantity: 1, price: 4990, hsn: '0902', gst_rate: 18 }], seller: OTHER, buyer: ME, currency: 'INR', chit_id: 'b1', at: '2026-09-10' });
  return { chit_id: 'b1', direction: 'received', sells: false, purpose: 'invoice', invoice: made.invoice, provisional: false, seller: Object.assign({ entity_id: 'sup' }, OTHER), buyer: Object.assign({ entity_id: 'me' }, ME), at: '2026-09-10T05:00:00Z' };
})();
const out = TL.gstr3b(TL.ledger([sale, buy], ME), ME, '092026');
const a = out._cb.setoff;
eq(a.payable, { cgst: 0, sgst: 0, igst: 0 }, 'nothing to pay');
eq(a.carried, { cgst: 0, sgst: 0, igst: 440.58 }, 'IGST credit 440.58 kept');
eq(a.utilised.map((u) => u.from + '>' + u.against + ':' + u.amount), ['igst>cgst:228.81', 'igst>sgst:228.81'], 'IGST first against CGST, then SGST');
eq(a.pay_total, 0, 'pay total 0');
console.log(n + ' checks');
