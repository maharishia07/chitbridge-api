/**
 * tests/ar-1129.test.cjs - walk AR (UAE, 22 Nov 2026), batch 1129, hand figures in fils.
 *   AR-F-01  an invoice carrying a PARTIAL business_json.invoice (TranDtls only) is refused 422 INVOICE_INCOMPLETE at send; a complete money block (ValDtls.TotInvVal) passes; a draft and an order are not judged
 *   AR-F-02  a credit note says why (business_json.reason_words) where the seller's PACK asks for an explanation (AE yes; AU, IN no); the document types a credit note CRN, a debit note DBN
 *   AR-F-03  the stamped invoice carries the supplier's and the recipient's address (identities.address -> SellerDtls / BuyerDtls Addr1), from the one party reader
 *   AR-F-04  DocDtls.Dt is the shop's business day: 2026-11-21T20:11:56Z at Dubai (UTC+4) is 2026-11-22
 *   AR-F-06  a gathered clearance with no evidence is not met; an unknown standard is refused 422 STANDARD_UNKNOWN
 *   AR-F-07  move-in preflight asks the same shop-side gate the import asks (AE, open bills: refused, so not ready)
 * Hand: S invoices A 3 x Karak at 10.50 incl 5% = 3150 fils gross, 150 tax, 3000 net.
 * Run: node tests/ar-1129.test.cjs
 */
'use strict';
const path = require('path'), http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
const STANDARD_ROWS = [{ standard_key: 'iso-9001', doc_key: 'quality_manual' }];
require.cache[dbFile].exports = Object.assign({}, real, {
  query: async () => ({ rows: [], rowCount: 0 }),
  withEntity: async (entity, work) => work({ query: async (sql, params) => (/FROM standard_document WHERE standard_key = \$1 AND doc_key = \$2/.test(sql) ? { rows: STANDARD_ROWS.filter((r) => r.standard_key === params[0] && r.doc_key === params[1]).map(() => ({ one: 1 })) } : { rows: [], rowCount: 0 }) })
});
const express = require('express');
const sendBill = require(path.join(HERE, 'lib', 'chits-send-bill.js'));
const taxLines = require(path.join(HERE, 'lib', 'tax-lines.js'));
const readiness = require(path.join(HERE, 'lib', 'readiness.js'));
const gate = require(path.join(HERE, 'lib', 'move-in-gate.js'));
const movein = require(path.join(HERE, 'lib', 'books-movein.js'));
const hooks = require(path.join(HERE, 'lib', 'books-hooks.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== AR-F-01 · a partial money block is refused ==\n');
  const bj = (invoice) => ({ business_json: { invoice }, purpose: 'invoice', is_draft: false });
  let r = sendBill.incompleteInvoiceRefusal(bj({ TranDtls: { TaxSch: 'VAT' } }));
  ok('an invoice with only TranDtls is refused INVOICE_INCOMPLETE in words', r && r.code === 'INVOICE_INCOMPLETE' && /no total/.test(r.message), JSON.stringify(r));
  ok('a complete money block (TotInvVal 31.50) passes', sendBill.incompleteInvoiceRefusal(bj({ ValDtls: { TotInvVal: 31.5 } })) === null);
  ok('a text total is not a total', !!sendBill.incompleteInvoiceRefusal(bj({ ValDtls: { TotInvVal: 'abc' } })));
  ok('a draft is not judged', sendBill.incompleteInvoiceRefusal({ business_json: { invoice: { TranDtls: {} } }, purpose: 'invoice', is_draft: true }) === null);
  ok('an order carrying a partial object is not an invoice here', sendBill.incompleteInvoiceRefusal({ business_json: { invoice: { TranDtls: {} } }, purpose: 'order' }) === null);
  ok('no invoice object at all: the send prices the lines (not refused)', sendBill.incompleteInvoiceRefusal({ business_json: {}, purpose: 'invoice' }) === null);
  ok('a credit note with a partial block is refused too', !!sendBill.incompleteInvoiceRefusal({ business_json: { invoice: { TranDtls: {} } }, purpose: 'credit_note' }));

  console.log('\n== AR-F-02 · the credit note says why, by the seller pack ==\n');
  const reg = require(path.join(HERE, 'lib', 'regulation.js'));
  ok('the AE pack asks for an explanation; AU and IN do not', sendBill.reasonRequiredBy(reg.lookup('AE')) === true && sendBill.reasonRequiredBy(reg.lookup('AU')) === false && sendBill.reasonRequiredBy(reg.lookup('IN')) === false);
  const app = express(); app.use(express.json());
  const countries = { 'sell-ae': 'AE', 'sell-au': 'AU' };
  const step = sendBill.creditReasonStep(async (id) => countries[id] || null);
  app.post('/send', async (req, res) => {
    const state = { sender_id: req.body.sender, purpose: req.body.purpose || 'credit_note', is_draft: !!req.body.is_draft, counterBill: !!req.body.counterBill, business_json: req.body.business_json };
    if (await step(state, req, res)) return;
    if (!res.headersSent) res.json({ ok: true });
  });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port + '/send';
  const post = async (body) => { const x = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: x.status, body: await x.json().catch(() => ({})) }; };
  r = await post({ sender: 'sell-ae', business_json: {} });
  ok('AE credit note with no reason: 422 CREDIT_NOTE_REASON_MISSING', r.status === 422 && r.body.code === 'CREDIT_NOTE_REASON_MISSING', JSON.stringify(r));
  r = await post({ sender: 'sell-ae', business_json: { reason_words: '   ' } });
  ok('a blank reason is no reason', r.status === 422);
  r = await post({ sender: 'sell-ae', business_json: { reason_words: 'goods returned' } });
  ok('AE credit note with a reason passes', r.status === 200);
  r = await post({ sender: 'sell-au', business_json: {} });
  ok('AU credit note needs no reason (its pack does not ask)', r.status === 200);
  r = await post({ sender: 'sell-ae', purpose: 'invoice', business_json: {} });
  ok('an invoice is not asked for a reason', r.status === 200);
  r = await post({ sender: 'sell-ae', counterBill: true, business_json: {} });
  ok('a counter return is another door, not judged here', r.status === 200);
  server.close();

  console.log('\n== AR-F-02/03/04 · the stamped document ==\n');
  const party = (name, trn, address) => taxLines.partyOf({ gstn: trn, display_name: name, country: 'AE', address, policy_flags: {} });
  const seller = party('Chip Supplier LLC', '100123450090003', 'Shop 4, Al Rigga Road, Deira, Dubai');
  const buyer = party('Karak Cafe LLC', '100123450080003', 'Unit 7, Sheikh Zayed Road, Dubai');
  const lines = [{ name: 'Karak', qty: 3, unit_price: 10.5, rate: 5, quantity: 3, price: 10.5, gst_rate: 5, kind: 'standard' }];
  const inv = (purpose) => taxLines.invoiceFor({ lines, seller, buyer, currency: 'AED', purpose, at: '2026-11-21T20:11:56Z', doc_day: hooks.dayOf('2026-11-21T20:11:56Z', 'Asia/Dubai'), priceIncludesTax: true, chit_id: 'WAR-INV-1' }).invoice;
  const doc = inv('invoice');
  ok('the supplier address rides on SellerDtls (Addr1)', doc.SellerDtls && doc.SellerDtls.Addr1 === 'Shop 4, Al Rigga Road, Deira, Dubai', JSON.stringify(doc.SellerDtls));
  ok('the recipient address rides on BuyerDtls (Addr1)', doc.BuyerDtls && doc.BuyerDtls.Addr1 === 'Unit 7, Sheikh Zayed Road, Dubai', JSON.stringify(doc.BuyerDtls));
  ok('a party with no address stays without the key (no new empty field)', !('Addr1' in taxLines.partyOf({ gstn: null, display_name: 'X', country: 'AE' })));
  ok('the date is the Dubai business day 2026-11-22, not the UTC instant', doc.DocDtls.Dt === '2026-11-22', doc.DocDtls.Dt);
  ok('hand: 3 x 10.50 incl 5% = 31.50 total (3150 fils)', Math.round(doc.ValDtls.TotInvVal * 100) === 3150, JSON.stringify(doc.ValDtls));
  ok('an invoice types INV, a credit note CRN, a debit note DBN', doc.DocDtls.Typ === 'INV' && inv('credit_note').DocDtls.Typ === 'CRN' && inv('debit_note').DocDtls.Typ === 'DBN');

  console.log('\n== AR-F-06 · no evidence is not met ==\n');
  const docs = [{ standard_key: 'iso-9001', doc_key: 'quality_manual', title: 'Manual' }, { standard_key: 'iso-9001', doc_key: 'audit', title: 'Audit' }, { standard_key: 'iso-9001', doc_key: 'policy', title: 'Policy' }];
  const gathered = {
    'iso-9001|quality_manual': { status: 'gathered', evidence_ref: null, valid_until: null, verification: {} },
    'iso-9001|audit': { status: 'gathered', evidence_ref: 'cert-123', valid_until: null, verification: {} },
    'iso-9001|policy': { status: 'gathered', evidence_ref: null, valid_until: null, verification: { method: 'registry' } }
  };
  const items = readiness.buildItems(docs, gathered, {});
  const sum = readiness.summarize(items);
  ok('a document gathered with no evidence is pending, not met', items[0].status === 'pending' && items[0].rung === null, JSON.stringify(items[0]));
  ok('evidence (a reference) or a registry stamp counts: 2 met of 3', items[1].status === 'gathered' && items[2].status === 'gathered' && sum.met === 2 && sum.pending === 1 && sum.ready === false, JSON.stringify(sum));
  let refused = null;
  try { await readiness.gatherDocument('e1', { standard_key: 'no-such-standard', doc_key: 'x', evidence_ref: 'r' }); } catch (e) { refused = e; }
  ok('an unknown standard is refused 422 STANDARD_UNKNOWN in words, nothing recorded', refused && refused.status === 422 && refused.code === 'STANDARD_UNKNOWN' && /no-such-standard/.test(refused.message), String(refused && refused.message));
  let known = null;
  try { await readiness.gatherDocument('e1', { standard_key: 'iso-9001', doc_key: 'quality_manual', evidence_ref: 'r' }); } catch (e) { known = e; }
  ok('a known standard + document goes on (past the check)', !known || known.code !== 'STANDARD_UNKNOWN', String(known && known.message));

  console.log('\n== AR-F-07 · preflight asks the gate of the import ==\n');
  let gateCode = null;
  try { gate.gate({ country: 'AE', kind: 'open_bills', source_country: 'AE' }); } catch (e) { gateCode = e.code; }
  const shut = movein.moveInShut({ books: { country: 'AE' } }, 'open_bills');
  ok('the import refuses AE open bills (MOVE_IN_COUNTRY) and the preflight says the same code and a sentence', gateCode === 'MOVE_IN_COUNTRY' && shut && shut.code === gateCode && /not ready/.test(shut.why), JSON.stringify([gateCode, shut]));
  ok('an AU shop is not shut (its pack has a map): ready stands', movein.moveInShut({ books: { country: 'AU' } }, 'open_bills') === null);

  console.log(String(pass) + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
