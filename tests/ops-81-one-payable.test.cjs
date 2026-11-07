/**
 * ops-81-one-payable.test.cjs — OPS-81 · A SUPPLIER BILL POSTS ONE PAYABLE, WHICHEVER PAPER ARRIVES FIRST.
 * Kumar Traders' bill KT/77, ₹1,000 + 12% GST = ₹1,120, reaches the books twice: as MY receipt of their bill (rcpt-1, counted at the counter)
 * and as THEIR invoice on the rail (inv-1, order.from ord-1). Each is accepted and posted through every door (postChit, a retry, the outbox sweep).
 *   hand-computed: exactly ONE purchase_bill, ₹1,120 (112000 minor) credited to Kumar Traders; the second paper is a no-op naming the first entry.
 * Run: node tests/ops-81-one-payable.test.cjs   (BOOKS_ENGINES_SRC = the engines checkout)
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', KT = '33333333-3333-4333-8333-333333333333';
const ENTRY = { sells: false, seller: { entity_id: KT, LglNm: 'Kumar Traders' }, buyer: { entity_id: SHOP }, me: { entity_id: SHOP },
  invoice: { currency: 'INR', ItemList: [{ GstRt: 12, AssAmt: 1000, CgstAmt: 60, SgstAmt: 60, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 1120 } } };
const rcpt = (st) => ({ chit_id: 'rcpt-1', purpose: 'receipt', sender_entity_id: SHOP, created_at: '2026-10-13T05:00:00Z', current_status: st, currency_code: 'INR',
  business_json: { doc: 'receipt', doc_no: 'R/0007', party: { name: 'Kumar Traders', party_id: KT }, against: { chit_id: 'ord-1' }, their_bill: { no: 'KT/77', date: '2026-10-13', total: 1120 } },
  line_items: [{ particulars: 'Rice', quantity: 10, unit: 'bag', price: 100, total: 1000, gst_rate: 12 }] });
const invc = (st) => ({ chit_id: 'inv-1', purpose: 'invoice', sender_entity_id: KT, created_at: '2026-10-14T05:00:00Z', current_status: st, currency_code: 'INR',
  business_json: { invoice_no: 'KT/77', order: { from: 'ord-1' } }, line_items: [] });

(async () => {
  console.log('\n══ OPS-81 · ONE PAYABLE FOR ONE SUPPLIER BILL ══\n');
  const X = H.load(), K = require(path.join(H.API, 'lib', 'books-hooks'));
  if (!X.src.dir) { console.log('   SKIP ' + X.src.why); process.exit(0); }
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  let copies = {}, rcptRows = [], invRows = [];
  TC.copyOf = async (id) => copies[id] || null; TC.entryFor = async () => ENTRY;
  const q0 = X.db.query;
  X.db.query = async (t, v) => {
    const s = String(t);
    if (/purpose = 'invoice' AND sender_entity_id IS DISTINCT FROM/.test(s)) return { rows: invRows.filter((x) => x.on === v[1]) };
    if (/purpose = 'receipt' AND sender_entity_id IS NOT DISTINCT FROM/.test(s)) return { rows: rcptRows.filter((x) => v[1].indexOf(x.on) >= 0) };
    if (/FROM chit_status cs JOIN chit_header h/.test(s)) return { rows: v[1].map((id) => ({ chit_id: id })) };
    return q0(t, v);
  };
  K._mover.fn = async () => ({ code: 200, moved: true });
  const fresh = async () => {
    X.T.entries.length = 0; X.T.lines.length = 0; X.T.outbox.length = 0; X.T.parties = X.T.parties.filter((p) => p.owner !== SHOP);
    X.T.parties.push({ owner: SHOP, party_id: KT, name: 'Kumar Traders', party_no: 'P-1', supplier: true });
    await X.store.saveSetting(X.db, SHOP, { enabled: true }); await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-10-01' }).catch(() => {}); K.forget(SHOP);
    rcptRows = [{ on: 'ord-1', chit_id: 'rcpt-1', no: 'KT/77' }];
    invRows = [];
  };
const theirInvoiceArrives = () => { invRows = [{ on: 'ord-1', chit_id: 'inv-1', no: 'KT/77' }]; };
  const bills = () => X.T.entries.filter((e) => e.entity_id === SHOP && e.event_type === 'purchase_bill');
  const payable = () => bills().reduce((sum, e) => sum + X.T.lines.filter((l) => l.entry_id === e.entry_id && l.party_id === KT).reduce((s2, l) => s2 + (l.cr_minor || 0) - (l.dr_minor || 0), 0), 0);

  /* ── 1 · the receipt posts first, their invoice comes later ── */
  await fresh(); copies = { 'rcpt-1': rcpt('accepted'), 'inv-1': invc('accepted') };
  const r = await K.postChit(SHOP, 'rcpt-1', {});
  eq('receipt accepted → ONE purchase_bill, 112000 minor owed to Kumar Traders', [r.ok, bills().length, payable()], [true, 1, 112000]);
  const first = bills()[0]; theirInvoiceArrives();
  const i1 = await K.postChit(SHOP, 'inv-1', {});
  eq('their invoice for the same order → a no-op that names the first entry', [i1.none, i1.why], [true, 'Receipt KT/77 already booked their bill (entry ' + first.entry_no + ') — this invoice is the paper, not a second payable.']);
  const i2 = await K.postChit(SHOP, 'inv-1', { retry: true });
  await K.retryOutbox(SHOP, 20);
  eq('…a retry and the outbox sweep: still one bill, the same amount, the same entry', [i2.none, bills().length, payable(), bills()[0].entry_id === first.entry_id], [true, 1, 112000, true]);

  /* ── 2 · the other order stays as it was: invoice first, the receipt is the goods record ── */
  await fresh(); copies = { 'rcpt-1': rcpt('accepted'), 'inv-1': invc('accepted') };
  theirInvoiceArrives(); await K.postChit(SHOP, 'inv-1', {}); const r2 = await K.postChit(SHOP, 'rcpt-1', {});
  eq('invoice first, then the receipt → one bill (chit:inv-1); the receipt answers "Their invoice … is the bill"', [bills().length, bills()[0].source_ref, payable(), r2.none], [1, 'chit:inv-1', 112000, true]);

  /* ── 3 · a receipt bill that was REVERSED (rejected after posting) no longer holds the payable: the invoice posts ── */
  await fresh(); copies = { 'rcpt-1': rcpt('accepted'), 'inv-1': invc('accepted') };
  await K.postChit(SHOP, 'rcpt-1', {}); await K.postChit(SHOP, 'rcpt-1', {});
  const e0 = bills()[0]; X.T.entries.push({ entity_id: SHOP, entry_id: 'rev-1', entry_no: 'JV-9', event_type: 'reversal', source_ref: 'reverse:' + e0.entry_id, reverses_entry_id: e0.entry_id });
  const i3 = await K.postChit(SHOP, 'inv-1', {});
  eq('receipt bill reversed → their invoice posts its own bill', [i3.ok, bills().filter((e) => e.source_ref === 'chit:inv-1').length], [true, 1]);

  /* ── 4 · an invoice for ANOTHER order is its own bill ── */
  await fresh(); copies = { 'rcpt-1': rcpt('accepted'), 'inv-1': Object.assign(invc('accepted'), { business_json: { invoice_no: 'KT/78', order: { from: 'ord-2' } } }) };
  await K.postChit(SHOP, 'rcpt-1', {}); const i4 = await K.postChit(SHOP, 'inv-1', {});
  eq('a different order → two bills, as it must', [i4.ok, bills().length], [true, 2]);

  /* ── 5 · TWO PARTIAL BILLS name ONE order: the receipt booked KT/77; their second bill KT/78 for the same order is a different bill and posts ── */
  await fresh(); copies = { 'rcpt-1': rcpt('accepted'), 'inv-1': Object.assign(invc('accepted'), { business_json: { invoice_no: 'KT/78', order: { from: 'ord-1' } } }) };
  await K.postChit(SHOP, 'rcpt-1', {}); theirInvoiceArrives(); const i5 = await K.postChit(SHOP, 'inv-1', {});
  eq('same order, second partial bill KT/78 → posts its own bill (the receipt booked KT/77 only)', [i5.ok, bills().length, payable()], [true, 2, 224000]);

  K._mover.fn = null; X.db.query = q0;
  console.log('\n  ' + (fail ? '✗ ' + fail + ' FAILED · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
