/**
 * tests/gstr-one-source.test.cjs — THE GST RETURN AND GST CLOSE READ ONE HOME (Fable money review 2026-10-23, findings 1-3).
 *
 * OWNS      the proof that the rail GSTR-3B (lib/tax-copy ledgerFor → lib/tax-lines gstr3b) counts the same chits, in the same month, as the books
 *           that GST close reads (lib/books-period gstBalances): output tax and input credit by head, equal to the paisa.
 * CALLED BY scripts/guards.cjs · CI. No database: the books run in memory (tests/support/books-harness), the chits come from a stub of the two reads
 *           tax-copy makes. Needs the books engines (BOOKS_ENGINES_SRC, else ../chitbridge-engines/src); without them it SKIPs, said.
 * FLOW      fixture chits → tax-copy.entryFor → books-hooks.classify → books postEntry (cancel → chitWithdrawn) ┐
 *                                                                    → tax-copy.ledgerFor → gstr3b               ┴→ compared
 *
 * The fixture shop is in IST (September 2026): a sale, a CANCELLED sale, a sale at 23:30 IST on 30 Sep (18:00Z — still September), a sale at 00:15 IST on
 * 1 Oct (18:45Z on the 30th — October's, though a UTC month calls it September's), a sale to an SEZ buyer (zero-rated), a rate-0 (nil) line, a rate-0 line the
 * pack names non-GST, a purchase the buyer REJECTED, a purchase still waiting for acceptance, and a purchase accepted.
 * Run: node tests/gstr-one-source.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111',
  CUST = '22222222-2222-4222-8222-222222222222',
  SUPP = '33333333-3333-4333-8333-333333333333',
  SEZB = '44444444-4444-4444-8444-444444444444';
const IDS = {
  [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', timezone: 'Asia/Kolkata', policy_flags: { price_includes_tax: 'no' } },
  [CUST]: { identity_id: CUST, gstn: '33BBBBB0000B1Z5', display_name: 'Chola Auto Care', country: 'IN', policy_flags: {} },
  [SUPP]: { identity_id: SUPP, gstn: '33CCCCC0000C1Z5', display_name: 'Sri Supplies', country: 'IN', policy_flags: { price_includes_tax: 'no' } },
  [SEZB]: { identity_id: SEZB, gstn: '33DDDDD0000D1Z5', display_name: 'Zone Exports', country: 'IN', policy_flags: { gst_registration: 'sez' } }
};
const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR', timezone: 'Asia/Kolkata' };
const uuid = (n) => 'c0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const minor = (rupees) => Math.round(rupees * 100);

(async () => {
  console.log('\n══ GSTR-3B AND GST CLOSE: ONE HOME ══\n');
  const X = H.load();
  if (!X.src.dir) {
    console.log('   SKIP: ' + X.src.why);
    return;
  }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const T = require(path.join(H.API, 'lib', 'tax'));
  const TL = require(path.join(H.API, 'lib', 'tax-lines'));
  const BP = require(path.join(H.API, 'lib', 'books-period'));

  /* ── the fixture: copies as the chit tables hold them ── */
  const party = (id) => ({ Gstin: IDS[id].gstn, LglNm: IDS[id].display_name, State: '33', Pos: '33', RegType: String((IDS[id].policy_flags || {}).gst_registration || 'regular') });
  const frozen = (seller, buyer, lines) => T.determine({ seller: party(seller), buyer: party(buyer), lines });
  const line = (name, price, rate) => ({ name, hsn: '9999', qty: 1, unit_price: price, rate });
  const rows = [];
  const add = (n, o) => rows.push(Object.assign({ chit_id: uuid(n), purpose: 'invoice', role: 'Sender', currency_code: 'INR', summary_json: {}, line_items: [], created_at: o.at, sent_at: o.at, current_status: 'delivered' }, o));
  const sale = (n, buyer, lines, o) => add(n, Object.assign({ sender_entity_id: SHOP, all_recipients: [{ role: 'sender', entity_id: SHOP }, { role: 'receiver', entity_id: buyer }], business_json: { invoice: frozen(SHOP, buyer, lines) } }, o));
  const buy = (n, lines, o) => add(n, Object.assign({ sender_entity_id: SUPP, all_recipients: [{ role: 'sender', entity_id: SUPP }, { role: 'receiver', entity_id: SHOP }], business_json: { invoice: frozen(SUPP, SHOP, lines) } }, o));

  sale(1, CUST, [line('Brake pad', 1000, 18)], { at: '2026-09-10T05:00:00.000Z' }); /* taxable 1,000 · GST 180 */
  sale(2, CUST, [line('Cancelled job', 2000, 12)], { at: '2026-09-12T05:00:00.000Z', current_status: 'cancelled' }); /* posted at send, reversed on cancel */
  sale(3, CUST, [line('Tea', 400, 5), line('Salt (nil-rated)', 300, 0)], { at: '2026-09-30T18:00:00.000Z' }); /* 23:30 IST on the 30th: September */
  sale(4, SEZB, [line('Export part', 700, 18)], { at: '2026-09-20T05:00:00.000Z' }); /* SEZ buyer: zero-rated, no tax */
  sale(5, CUST, [line('Exempt service', 250, 0)], { at: '2026-09-22T05:00:00.000Z' }); /* rate 0, no kind: 3.1(c) */
  sale(6, CUST, [line('Newspaper (non-GST)', 150, 0)], { at: '2026-09-23T05:00:00.000Z' });
  rows[rows.length - 1].business_json.invoice._cb = Object.assign({}, rows[rows.length - 1].business_json.invoice._cb, { kinds: [{ line: 0, kind: 'non_gst', rate: 0 }] }); /* what a pack that names the kind would stamp */
  sale(7, CUST, [line('Next month', 500, 18)], { at: '2026-09-30T18:45:00.000Z' }); /* 00:15 IST on 1 Oct: October's */
  buy(8, [line('Rejected stock', 1000, 18)], { at: '2026-09-14T05:00:00.000Z', current_status: 'rejected' });
  buy(9, [line('Waiting stock', 800, 18)], { at: '2026-09-15T05:00:00.000Z', current_status: 'delivered' }); /* not accepted yet */
  buy(10, [line('Accepted stock', 600, 18)], { at: '2026-09-16T05:00:00.000Z', current_status: 'accepted' }); /* ITC 108 */
  rows.push(Object.assign({}, rows[0], { chit_id: uuid(11), role: 'Draft' })); /* a draft is no document */
  /* what the books never post, and the old return counted (Fable review of #362): */
  add(12, { purpose: 'general', sender_entity_id: SHOP, all_recipients: [{ role: 'sender', entity_id: SHOP }, { role: 'receiver', entity_id: CUST }], business_json: {},
    at: '2026-09-18T05:00:00.000Z', line_items: [{ line_id: 'l1', particulars: 'Bill INV-7', quantity: 1, price: 12500, total: 12500 }] }); /* a payment advice: priced words, no rate */
  add(13, { purpose: 'order', sender_entity_id: CUST, all_recipients: [{ role: 'sender', entity_id: CUST }, { role: 'receiver', entity_id: SHOP }], business_json: {},
    at: '2026-09-19T05:00:00.000Z', line_items: [{ line_id: 'l1', particulars: 'Brake pad', quantity: 2, price: 500, total: 1000, gst_rate: 18 }] }); /* a storefront order RECEIVED: classify posts nothing */
  buy(14, [line('Disputed stock', 900, 18)], { at: '2026-09-17T05:00:00.000Z', current_status: 'accepted', disputed: true }); /* accepted but the books hold it for a dispute */

  /* ── the two reads tax-copy makes, answered from the fixture (the books' own SQL stays in memory) ── */
  const momentOf = (r, newRule) => Date.parse((newRule && r.business_json && r.business_json.billed_at) || r.sent_at || r.created_at);
  const memory = require('./support/books-memory.cjs');
  const ask = memory.fakeDb.query;
  memory.fakeDb.query = async (text, params) => {
    const sql = String(text);
    if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: params[0].map((id) => IDS[id]).filter(Boolean) };
    if (/FROM identities WHERE identity_id = \$1/.test(sql) && /timezone/.test(sql)) return { rows: [IDS[params[0]]].filter(Boolean) };
    if (/FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [IDS[params[0]]].filter(Boolean) };
    if (/FROM chit_header h/.test(sql) && /h\.entity_id = \$1/.test(sql)) {
      const newRule = /billed_at/.test(sql),
        from = Date.parse(params[1]),
        to = Date.parse(params[2]);
      /* the SQL's EXISTS (tax-copy POSTED_IN_BOOKS_SQL), modelled on the in-memory journal: an unreversed entry of the chit's own, or one that covers it */
      const held = (r) => !/journal_entry/.test(sql) || X.T.entries.some((j) => j.entity_id === SHOP && !j.reverses_entry_id &&
        (String(j.source_ref || '').indexOf('chit:' + r.chit_id) === 0 || j.source_ref === 'bill:' + r.chit_id || (j.source_chit_ids || []).indexOf(r.chit_id) >= 0) &&
        !X.T.entries.some((v) => v.entity_id === SHOP && v.reverses_entry_id === j.entry_id));
      return { rows: rows.filter((r) => r.role !== 'Draft' && held(r) && momentOf(r, newRule) >= from && momentOf(r, newRule) < to) };
    }
    return ask(text, params);
  };
  delete require.cache[require.resolve(path.join(H.API, 'lib', 'tax-copy'))];
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));

  /* ── the books: every fixture chit through the posting rule ── */
  await X.store.saveSetting(X.db, SHOP, { enabled: true });
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-04-01' });
  K.forget(SHOP);
  [CUST, SEZB].forEach((id, k) => X.T.parties.push({ owner: SHOP, party_id: id, party_no: 'P-0000' + (k + 1), name: IDS[id].display_name, customer: true, credit_days: 30 }));
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00009', name: IDS[SUPP].display_name, supplier: true, credit_days: 30 });
  const posted = [];
  for (const r of rows.filter((x) => x.role !== 'Draft')) {
    const entry = await TC.entryFor(r, SHOP);
    const k = K.classify({ chit: r, entry, setting: S, status: r.current_status, disputed: !!r.disputed });
    if (k.kind !== 'post') continue;
    const out = await X.B.postEntry(X.db, SHOP, Object.assign({}, k.event, { source_chit_id: r.chit_id }));
    if (!out.ok) throw new Error('fixture did not post: ' + JSON.stringify(out));
    posted.push(r.chit_id);
    if (r.current_status === 'cancelled') await K.chitWithdrawn(X.db, SHOP, r.chit_id, 'cancelled by the seller', SHOP);
  }
  ok('the books posted the six sales/purchases they would post (cancelled one reversed; rejected + waiting purchases never)', posted.length === 8, JSON.stringify(posted.map((p) => p.slice(-2))));

  /* ── the books' home (what GST close reads) and the return ── */
  const pack = X.B.packOf(S);
  const books = await X.dbStub.withEntity(SHOP, (h) => BP.gstBalances(h, SHOP, '2026-09-30', null, pack));
  const { bounds, me, ledger } = await TC.ledgerFor(SHOP, '2026-09');
  const ret = TL.gstr3b(ledger, me, bounds.period);
  const o = ret.sup_details.osup_det,
    i = ret.itc_elg.itc_net;
  console.log('\n   books  output', JSON.stringify(books.output), ' input', JSON.stringify(books.input));
  console.log('   return output cgst/sgst/igst', minor(o.camt), minor(o.samt), minor(o.iamt), ' itc', minor(i.camt), minor(i.samt), minor(i.iamt));
  console.log('   return 3.1(a)', o.txval, ' (b)', ret.sup_details.osup_zero.txval, ' (c)', ret.sup_details.osup_nil_exmp.txval, ' (e)', ret.sup_details.osup_nongst.txval, ' rows', ledger.count, '\n');

  eq('the return is for September in the shop\'s zone (IST), not the UTC month', [bounds.month, bounds.from, bounds.to], ['2026-09', '2026-08-31T18:30:00.000Z', '2026-09-30T18:30:00.000Z']);
  eq('OUTPUT TAX = GST close\'s output balance, per head, to the paisa', [minor(o.camt), minor(o.samt), minor(o.iamt)], [books.output.cgst, books.output.sgst, books.output.igst]);
  eq('INPUT CREDIT = GST close\'s input balance, per head, to the paisa', [minor(i.camt), minor(i.samt), minor(i.iamt)], [books.input.cgst, books.input.sgst, books.input.igst]);
  eq('…so net payable agrees too', minor(ledger.net.total), books.output.cgst + books.output.sgst + books.output.igst - books.input.cgst - books.input.sgst - books.input.igst);
  eq('the tax is the three September sales that stand: 90+90 (18%) + 10+10 (5%) = 100 + 100, and ITC only the accepted purchase 54 + 54',
    [books.output.cgst, books.output.sgst, books.input.cgst, books.input.sgst], [10000, 10000, 5400, 5400]);

  const rowIds = ledger.rows.map((r) => r.chit_id.slice(-2)).sort();
  eq('rows: sales 1 3 4 5 6 and the accepted purchase 10 — not the cancelled (reversed) sale, the rejected, waiting or dispute-held purchase, the payment advice, the received storefront order, next month\'s bill, nor the draft', rowIds, ['01', '03', '04', '05', '06', '10']);
  eq('the 23:30 IST bill is September\'s and its document date is the 30th', ledger.rows.filter((r) => r.chit_id.endsWith('03')).map((r) => r.day), ['2026-09-30']);

  /* ── 3.1: the boxes add up to the taxable value and split by supply kind ── */
  eq('3.1(a) taxable: 1,000 + 400', o.txval, 1400);
  eq('3.1(b) zero-rated (the SEZ sale)', ret.sup_details.osup_zero.txval, 700);
  eq('3.1(c) nil-rated / exempt: the 300 nil line + the 250 exempt service', ret.sup_details.osup_nil_exmp.txval, 550);
  eq('3.1(e) non-GST (the line the pack names non-GST)', ret.sup_details.osup_nongst.txval, 150);
  eq('the four boxes add up to the ledger\'s outward taxable value', o.txval + ret.sup_details.osup_zero.txval + ret.sup_details.osup_nil_exmp.txval + ret.sup_details.osup_nongst.txval, ledger.output.taxable);

  /* ── finding 10: a registered shop's taxed sale whose supply cannot be decided waits, in words (it used to post with every head 0) ── */
  const lost = JSON.parse(JSON.stringify(rows[0]));
  lost.business_json.invoice._cb = Object.assign({}, lost.business_json.invoice._cb, { supply: 'unknown' });
  ['CgstAmt', 'SgstAmt', 'IgstAmt'].forEach((k) => lost.business_json.invoice.ItemList.forEach((item) => { item[k] = 0; }));
  const held = K.classify({ chit: lost, entry: await TC.entryFor(lost, SHOP), setting: S, status: 'delivered' });
  ok('a taxed sale whose place of supply is unknown WAITS in words', held.kind === 'queue' && /cannot be decided/.test(held.why), JSON.stringify(held));

  /* ── C2: the books and the return's SQL honour the same billed_at shape ── */
  const sent = '2026-09-10T05:00:00.000Z';
  eq('a malformed free-text billed_at falls back to the send, as the SQL does', [K.postingMoment({ business_json: { billed_at: 'yesterday evening' }, sent_at: sent }), K.postingMoment({ business_json: { billed_at: '2026-09-09 18:35:00' }, sent_at: sent })], [sent, '2026-09-09 18:35:00']);
  ok('…and tax-copy builds its SQL window from that very shape', require('fs').readFileSync(path.join(H.API, 'lib', 'tax-copy.js'), 'utf8').indexOf('BILLED_AT_SHAPE.source') > 0 && K.BILLED_AT_SHAPE.test('2026-09-09 18:35'));

  /* ── the keys an older reader knew are still there ── */
  ok('the old answer keys stay (gstin · ret_period · osup_det.txval/iamt/camt/samt/csamt · itc_net · _cb.net)',
    ret.gstin === IDS[SHOP].gstn && ret.ret_period === '092026' && ['txval', 'iamt', 'camt', 'samt', 'csamt'].every((k) => k in o) && 'iamt' in i && ret._cb && ret._cb.net);

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
