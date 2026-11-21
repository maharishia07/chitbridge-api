/**
 * tests/ay-1129.test.cjs - walk AY (22 Nov 2026): AY-F-01 a credit note follows its bill's supply (IGST for an inter-state bill, CDNUR in GSTR-1), AY-F-03 a PO line of quantity 0 is refused,
 * AY-F-04 a goods receipt dated after the shop's today is refused, AY-F-06 the e-invoice block names its Version and DocDtls.
 * The steps are routes/chits.js SEND_STEPS themselves, run from an empty state ({}) in order up to and including sendMoney (the real engine prices the note); only the database is a stand-in.
 * HAND (paise, AY-C05): the bill 100 jugs x 118.00 incl 18% = 11,800.00 per 100 -> the NOTE of 100 x 118 = txval 10,000.00, IGST 1,800.00, CGST 0, SGST 0; the bill was 106,200.00 (> the 1,00,000 B2CL limit).
 * lib/shop-day-ahead.js is a unit under test here. MIN unit-per-rule · refusal-path · fail-closed (a receipt dated ahead writes nothing).
 * Run: node tests/ay-1129.test.cjs   (needs the adopted engines under lib/)
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
const BILL = '22222222-2222-4222-8222-222222222222';
let billPos = '27'; /* the original bill's place of supply as its frozen invoice says */
const FROZEN_BILL = () => ({ no: 'C/C1/26-27/0003', at: '2026-11-19T11:00:00+05:30', zone: 'Asia/Kolkata', pos: billPos, invoice_total: 106200 });
const read = async (sql) => {
  if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: [{ identity_id: 'shop-IN', gstn: '33AAAAA0000A1Z5', display_name: 'Shop', policy_flags: { price_includes_tax: 'yes' }, country: 'IN', address: null, timezone: 'Asia/Kolkata' }] };
  if (/FROM chit_header h/.test(sql) && /PrecDocDtls|AS pos/.test(sql)) return { rows: [FROZEN_BILL()] };
  if (/SELECT country FROM identities WHERE identity_id = $1/.test(sql)) return { rows: [{ country: 'IN' }] };
  if (/SELECT country, currency_code, timezone/.test(sql)) return { rows: [{ country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata' }] };
  if (/FROM identities/.test(sql)) return { rows: [{ bridge_id: 'b-1', display_name: 'Shop' }] };
  return { rows: [], rowCount: 0 };
};
require.cache[dbFile].exports = Object.assign({}, real, { query: read, withEntity: async (entity, work) => work({ query: read }) });
require('../lib/country-setup').registrationOfShop = async () => 'regular';
const chits = require(path.join(HERE, 'routes', 'chits.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/** the real steps from {} up to and including sendMoney */
async function drive(body) {
  const req = { body, headers: {}, user: {}, identity: { bridge_id: 'b-1', display_name: 'Shop', entity_id: 'shop-IN', identity_id: 'shop-IN', identity_type: 'entity' } };
  const res = { locals: { kind: undefined }, headersSent: false, statusCode: 200, status(c) { this.code = c; this.statusCode = c; return this; }, set() { return this; }, setHeader() {}, type() { return this; }, once() {}, json(b) { this.headersSent = true; this.body = b; return this; }, send(b) { this.headersSent = true; this.body = b; return this; } };
  const state = {};
  const last = chits.SEND_STEPS.indexOf(chits.sendMoney);
  for (let i = 0; i <= last; i++) {
    const out = await chits.SEND_STEPS[i](state, req, res);
    if (out || res.headersSent) return { stoppedAt: chits.SEND_STEPS[i].name, status: res.code, body: res.body, state };
  }
  return { stoppedAt: null, state };
}
const note = (customer) => ({
  recipients: [{ self: true, name: 'self' }], purpose: 'credit_note', subject: 'Credit note C/C1/26-27/0001', manual_subject: 'Credit note C/C1/26-27/0001', client_ref: 'C/C1/26-27/0001',
  business_json: { doc: 'credit_note', slip: 'credit_note', till: { id: 'C1', name: 'Counter 1', host: 'browser' }, reason: 'damaged', reason_words: 'Damaged or spoilt', refund: { parts: [{ how: 'Cash', amount: 11800 }], total: 11800 }, against: { bill_no: 'C/C1/26-27/0003', chit_id: BILL, billed_at: '2026-11-19T11:00:00+05:30' }, bill_no: 'C/C1/26-27/0001', billed_at: '2026-11-21T10:00:00+05:30', customer },
  line_items: [{ hsn: '7323', unit: 'piece', price: 118, total: -11800, gst_rate: 18, quantity: 100, particulars: 'Steel jug' }]
});

(async () => {
  console.log('\n== AY-F-01 · a credit note follows its bill: IGST for an inter-state bill, through the real step order ==\n');
  /* (1) a NOTE THE SERVER PRICES AT SEND (no till block: not a counter bill) */
  const railNote = (customer) => { const n = note(customer); delete n.business_json.till; delete n.business_json.bill_no; return n; };
  let r = await drive(railNote({ name: 'Big retail MH' }));
  const inv = r.state.originInvoice || {};
  ok('the steps reach the engine and the note is priced', r.stoppedAt === null && inv.ValDtls, JSON.stringify([r.stoppedAt, r.status, r.body]));
  ok('inter-state bill: IGST 1,800.00 on a taxable 10,000.00 (the AY-C05 hand figures)', inv.ValDtls && inv.ValDtls.AssVal === 10000 && inv.ValDtls.IgstVal === 1800, JSON.stringify(inv.ValDtls));
  ok('...and no CGST or SGST', inv.ValDtls && !inv.ValDtls.CgstVal && !inv.ValDtls.SgstVal, JSON.stringify(inv.ValDtls));
  ok('it carries the bill it corrects (number, date)', inv.RefDtls && inv.RefDtls.PrecDocDtls[0].InvNo === 'C/C1/26-27/0003', JSON.stringify(inv.RefDtls));
  /* (2) a COUNTER note: priced by the live copy and frozen later, from what the send recorded on it */
  r = await drive(note({ name: 'Big retail MH' }));
  const bj = r.state.business_json || {};
  ok('a counter note records the bill\'s place of supply (27) and value (106200) in the slots the tax readers read', bj.delivery && bj.delivery.state_code === '27' && bj.against && bj.against.total === 106200, JSON.stringify([bj.delivery, bj.against]));
  const taxLines = require('../lib/tax-lines');
  const taxCopy = require('../lib/tax-copy');
  const seller = taxLines.partyOf({ identity_id: 'shop-IN', gstn: '33AAAAA0000A1Z5', display_name: 'Shop', country: 'IN' });
  const buyer = taxCopy.withRecordedPos(taxCopy.counterBuyerOf(bj.customer, seller), bj);
  const live = taxLines.invoiceFor({ lines: r.state.line_items, seller, buyer, currency: 'INR', at: '2026-11-21T10:00:00+05:30', priceIncludesTax: true, purpose: 'credit_note' }).invoice;
  ok('the live copy of the counter note: IGST 1,800.00, no CGST or SGST', live.ValDtls.AssVal === 10000 && live.ValDtls.IgstVal === 1800 && !live.ValDtls.CgstVal && !live.ValDtls.SgstVal, JSON.stringify(live.ValDtls));
  const row = { side: 'output_cn', invoice: live, doc_no: 'C/C1/26-27/0001', at: '2026-11-21T10:00:00+05:30', day: '2026-11-21', period_of_record: '2026-11', against_value: taxLines.againstValueOf(bj, 'credit_note') };
  const gj = taxLines.gstr1({ rows: [row] }, seller, '112026');
  ok('the note lands in CDNUR typ B2CL pos 27 val 11800 txval 10000 iamt 1800', gj.cdnur && gj.cdnur.length === 1 && gj.cdnur[0].typ === 'B2CL' && String(gj.cdnur[0].pos) === '27' && gj.cdnur[0].val === 11800 && gj.cdnur[0].itms[0].itm_det.txval === 10000 && gj.cdnur[0].itms[0].itm_det.iamt === 1800, JSON.stringify(gj.cdnur));
  ok('...and nets nothing off b2cs (no negative row)', !gj.b2cs || gj.b2cs.length === 0, JSON.stringify(gj.b2cs));

  billPos = '33';
  r = await drive(railNote({ name: 'Walk-in' }));
  ok('a note on an INTRA-state bill is still CGST+SGST 900.00 each', r.state.originInvoice && r.state.originInvoice.ValDtls.CgstVal === 900 && r.state.originInvoice.ValDtls.SgstVal === 900 && !r.state.originInvoice.ValDtls.IgstVal, JSON.stringify(r.state.originInvoice && r.state.originInvoice.ValDtls));
  billPos = '27';
  const none = railNote({ name: 'Walk-in' });
  none.business_json.against = {};
  r = await drive(none);
  ok('a note that names no bill is priced as before (intra, nothing carried)', r.state.originInvoice && r.state.originInvoice.ValDtls.CgstVal === 900 && !r.state.originInvoice.RefDtls && !r.state.business_json.delivery, JSON.stringify(r.state.originInvoice && r.state.originInvoice.ValDtls));

  console.log('\n== AY-F-03 · a PO line of quantity 0 is refused in words, through the real step order ==\n');
  const po = (quantity, extra) => Object.assign({ recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'PO AY-1', manual_subject: 'PO AY-1', client_ref: 'AY-1', business_json: { order_no: 'AY-1', party: { name: 'Supplier AY' } }, line_items: [{ particulars: 'Steel jug', quantity, unit: 'piece', price: 100, total: quantity * 100, gst_rate: 18, hsn: '7323' }] }, extra || {});
  r = await drive(po(0));
  ok('quantity 0 on a PO line: refused 400 BAD_QTY in words, nothing sent', r.stoppedAt === 'sendReceiptLines' && r.status === 400 && r.body && r.body.code === 'BAD_QTY' && /needs a quantity above 0/.test(String(r.body.detail || r.body.message)), JSON.stringify([r.stoppedAt, r.status, r.body && r.body.code, r.body && (r.body.detail || r.body.message)]));
  r = await drive(po(-3));
  ok('quantity -3: refused at the same step, same words', r.stoppedAt === 'sendReceiptLines' && r.body && r.body.code === 'BAD_QTY', JSON.stringify([r.stoppedAt, r.body && r.body.code]));
  r = await drive(po(2));
  ok('quantity 2 passes the step (the order goes on to the engine)', r.stoppedAt !== 'sendReceiptLines', JSON.stringify([r.stoppedAt, r.status]));
  r = await drive(po(0, { is_draft: true }));
  ok('a DRAFT with quantity 0 is not judged (it is still being written)', r.stoppedAt !== 'sendReceiptLines', JSON.stringify([r.stoppedAt]));
  const till = po(0);
  till.business_json = { bill_no: 'C/C1/26-27/0009', till: { id: 'C1' } };
  r = await drive(till);
  ok('AZ-F-01 a counter bill of quantity 0 is refused too, at the same step (it was let through: held later in the books)', r.stoppedAt === 'sendReceiptLines' && r.status === 400 && r.body && r.body.code === 'BAD_QTY', JSON.stringify([r.stoppedAt, r.status, r.body && r.body.code]));
  const credit = po(0); credit.purpose = 'credit_note'; credit.business_json = { doc: 'credit_note', till: { id: 'C1' }, bill_no: 'C/C1/26-27/0010' };
  r = await drive(credit);
  ok('AX-F-04 a credit note line of quantity 0 is refused at the same step, in words', r.stoppedAt === 'sendReceiptLines' && r.status === 400 && r.body && r.body.code === 'BAD_QTY', JSON.stringify([r.stoppedAt, r.status]));
  credit.line_items = [{ name: 'Jug', quantity: 1, price: 100 }];
  r = await drive(credit);
  ok('AX-F-04 a credit note line of quantity 1 passes this step', r.stoppedAt !== 'sendReceiptLines', JSON.stringify([r.stoppedAt]));

  console.log('\n== AY-F-04 · a goods receipt dated after the shop\'s today is refused ==\n');
  const grn = (at) => ({ recipients: [{ self: true, name: 'self' }], purpose: 'receipt', subject: 'Goods received AY-G', manual_subject: 'Goods received AY-G', client_ref: 'AY-G', business_json: { doc: 'receipt', doc_no: 'AY-G', doc_at: at, against: { chit_id: BILL }, party: { name: 'Supplier AY' } }, line_items: [{ particulars: 'Steel jug', quantity: 1, unit: 'piece', price: 100, total: 100, gst_rate: 18, hsn: '7323' }] });
  r = await drive(grn('2099-01-01T00:00:00.000Z'));
  ok('a receipt dated 2099-01-01: refused 400 RECEIPT_DATE_AHEAD in words', r.stoppedAt === 'sendReceiptLines' && r.status === 400 && r.body && r.body.code === 'RECEIPT_DATE_AHEAD', JSON.stringify([r.stoppedAt, r.status, r.body && r.body.code]));
  r = await drive(grn(new Date().toISOString()));
  ok('a receipt dated now is accepted', r.stoppedAt !== 'sendReceiptLines', JSON.stringify([r.stoppedAt, r.body && r.body.code]));
  r = await drive(grn('2026-04-12T00:00:00.000Z'));
  ok('a receipt dated in the past is accepted', r.stoppedAt !== 'sendReceiptLines', JSON.stringify([r.stoppedAt, r.body && r.body.code]));

  console.log('\n== AY-F-06 · the e-invoice block names its Version and DocDtls ==\n');
  const carried = { ValDtls: { TotInvVal: 1180 }, TranDtls: { SupTyp: 'B2B' } };
  const answer = taxCopy.invoiceFrom({ chit_id: 'c-1', invoice: carried, purpose: 'order', doc_no: 'C/C1/26-27/0001', at: '2026-11-18T11:00:00+05:30', seller: { timezone: 'Asia/Kolkata' } });
  ok('a till-carried invoice with no DocDtls reads Version 1.1 and DocDtls Typ INV, No, Dt (the shop day)', answer.invoice.Version === '1.1' && answer.invoice.DocDtls.Typ === 'INV' && answer.invoice.DocDtls.No === 'C/C1/26-27/0001' && answer.invoice.DocDtls.Dt === '2026-11-18', JSON.stringify([answer.invoice.Version, answer.invoice.DocDtls]));
  ok('the stored invoice is not changed by the read', carried.Version === undefined && carried.DocDtls === undefined);
  const had = taxCopy.invoiceFrom({ chit_id: 'c-2', invoice: { DocDtls: { Typ: 'CRN', No: 'N-9', Dt: '2026-11-20' } }, purpose: 'credit_note', doc_no: 'X', at: '2026-11-21T00:00:00Z', seller: {} });
  ok('a DocDtls the invoice already carries is kept as it is', had.invoice.DocDtls.Typ === 'CRN' && had.invoice.DocDtls.No === 'N-9' && had.invoice.DocDtls.Dt === '2026-11-20', JSON.stringify(had.invoice.DocDtls));

  console.log(String(pass) + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
