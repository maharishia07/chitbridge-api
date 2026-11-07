// tests/tax-lines.test.js — the engine reaches the chit: lines rated at send, the invoice per copy, the month's ledger.
// CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tax-lines');

const slabs = [{ definition_id: 'IN-GST-5', name: 'GST 5%', rules: { rate: 5 }, governance: { jurisdiction: 'IN' } },
               { definition_id: 'IN-GST-18', name: 'GST 18%', rules: { rate: 18 } }];
const items = [{ item_id: 'i1', item_data: { name: 'Ponni Rice', price: 620, tax_slab: 'IN-GST-5', hsn: '1006' } },
               { item_id: 'i2', item_data: { name: 'Sunflower Oil', price: 150 } }];
const shelf = { items, slabs, categories: [], face: { tax: { default_slab: 'IN-GST-18' } } };

test('decorate: a line naming a catalogue item (by id or by exact name) gets the rate the catalogue resolves, and says where from', () => {
  const out = T.decorate([{ name: 'Ponni Rice', item_id: 'i1', quantity: 2, price: 620 }, { name: 'sunflower oil', quantity: 1, price: 150 }, { name: 'Unknown thing', quantity: 1, price: 9 }], shelf);
  assert.equal(out[0].gst_rate, 5); assert.equal(out[0].tax_source, 'product'); assert.equal(out[0].hsn, '1006');
  assert.equal(out[1].gst_rate, 18); assert.equal(out[1].tax_source, 'catalogue');
  assert.equal(out[2].gst_rate, undefined, 'a line the catalogue cannot answer is left untouched');
});

test('decorate never re-rates a line that already carries a rate', () => {
  const out = T.decorate([{ name: 'Ponni Rice', item_id: 'i1', gst_rate: 12 }], shelf);
  assert.equal(out[0].gst_rate, 12);
});

test('partyOf: GSTIN gives the state; policy flag gives the registration', () => {
  const p = T.partyOf({ gstn: '33AAAAA0000A1Z5', display_name: 'Amrit', policy_flags: { gst_registration: 'composition' } });
  assert.equal(p.State, '33'); assert.equal(p.RegType, 'composition'); assert.equal(p.LglNm, 'Amrit');
  assert.equal(T.partyOf({}).State, null); assert.equal(T.partyOf({}).RegType, 'regular');
});

test('invoiceFor: rated lines produce the INV-01 block; unrated lines are counted, not invented', () => {
  const lines = [{ name: 'Ponni Rice', quantity: 2, price: 620, gst_rate: 5 }, { name: 'Bag', quantity: 1, price: 10 }];
  const r = T.invoiceFor({ lines, seller: { Gstin: '33A', State: '33' }, buyer: { Gstin: '29B', Pos: '29' }, chit_id: 'c1', at: '2026-09-04' });
  assert.equal(r.rated, 1); assert.equal(r.unrated, 1); assert.equal(r.provisional, true);
  assert.equal(r.invoice.ItemList[0].IgstAmt, 62);
  assert.equal(r.invoice.TranDtls.SupTyp, 'B2B');
});

test('⭐ ledger: output on my sent copies, ITC on my received copies from a regular seller, net = output − ITC; a self-chit is not a supply', () => {
  const mk = (dir, sellerId, buyerId, sellerReg, rate, at) => {
    const r = T.invoiceFor({ lines: [{ name: 'x', quantity: 1, price: 1000, gst_rate: rate }], seller: { Gstin: '33S', State: '33', RegType: sellerReg }, buyer: { Gstin: '33B', Pos: '33' }, chit_id: 'c' + at, at });
    return { chit_id: 'c' + at, direction: dir, invoice: r.invoice, provisional: false, seller: { entity_id: sellerId, RegType: sellerReg }, buyer: { entity_id: buyerId }, at };
  };
  const led = T.ledger([
    mk('sent', 'me', 'them', 'regular', 18, '2026-09-01'),        // output 180
    mk('received', 'them', 'me', 'regular', 5, '2026-09-02'),     // itc 50
    mk('received', 'comp', 'me', 'composition', 5, '2026-09-03'), // no itc: composition seller charges nothing
    mk('sent', 'me', 'me', 'regular', 18, '2026-09-04'),          // self: excluded
  ], { RegType: 'regular' });
  assert.equal(led.output.tax, 180); assert.equal(led.itc.tax, 50);
  assert.equal(led.net.total, 130);
  assert.equal(led.rows.length, 3);
  assert.equal(led.rows.find((r) => r.at === '2026-09-03').side, 'no-itc');
});

/* ACC-225 (2026-11-05): gstr1 is the adopted engine's (gst-returns.gstr1) — it asks a real 15-character GSTIN on me and refuses in words without one */
const ME_GSTIN = '33AAAAA0000A1Z5';
test('gstr1 groups B2B by counterparty GSTIN and B2C by place-of-supply + rate; gstr3b carries the totals and says it is provisional', () => {
  const inv = (buyer, rate) => T.invoiceFor({ lines: [{ name: 'x', quantity: 1, price: 100, gst_rate: rate, hsn: '1006' }], seller: { Gstin: '33S', State: '33' }, buyer, chit_id: 'c1', at: '2026-09-04' }).invoice;
  const led = T.ledger([
    { chit_id: 'a', direction: 'sent', invoice: inv({ Gstin: '29B', Pos: '29' }, 18), provisional: true, seller: { entity_id: 'me' }, buyer: { entity_id: 'b' }, at: '2026-09-04' },
    { chit_id: 'b', direction: 'sent', invoice: inv({ Pos: '33' }, 5), provisional: false, seller: { entity_id: 'me' }, buyer: { entity_id: 'c' }, at: '2026-09-04' },
  ], { RegType: 'regular' });
  const g1 = T.gstr1(led, { Gstin: ME_GSTIN }, '092026');
  assert.equal(g1.b2b.length, 1); assert.equal(g1.b2b[0].ctin, '29B'); assert.equal(g1.b2b[0].inv[0].itms[0].itm_det.iamt, 18);
  assert.equal(g1.b2cs.length, 1); assert.equal(g1.b2cs[0].camt, 2.5);
  assert.deepEqual(g1.b2cl, [], 'the B2CL table is there (empty here: nothing inter-state B2C above the limit)');
  assert.equal(g1.hsn.data[0].hsn_sc, '1006');
  assert.equal(g1._cb.b2cl_limit, 100000, 'September 2026 files on the ₹1 lakh limit (Notification 12/2024)');
  assert.equal(T.gstr1(led, { Gstin: '33S' }, '092026').ok, false, 'no 15-character GSTIN on me → the engine refuses in words, never a file with gstin null');
  const g3 = T.gstr3b(led, { Gstin: ME_GSTIN }, '092026');
  assert.equal(g3.sup_details.osup_det.iamt, 18); assert.equal(g3._cb.provisional, true);
});

/* ⚠️⚠️ 2026-09-28: a counter return is a self chit with a customer, so it arrived as the shop's SALE and was ADDED to output */
{
  const inv = (buyer, rate, price, supply) => {
    const r = T.invoiceFor({ lines: [{ name: 'x', quantity: 1, price, gst_rate: rate, hsn: '1006' }], seller: { Gstin: '33S', State: '33' }, buyer, chit_id: 'c', at: '2026-09-04' }).invoice;
    if (supply) r._cb = Object.assign({}, r._cb, { supply });
    return r;
  };
  const sale = (id, buyer, rate, price, no) => ({ chit_id: id, doc_no: no, direction: 'sent', sells: true, purpose: 'general', invoice: inv(buyer, rate, price), provisional: false, seller: { entity_id: 'me' }, buyer: { entity_id: null }, at: '2026-09-04' });
  const ret = (id, buyer, rate, price, no, supply) => Object.assign(sale(id, buyer, rate, price, no), { purpose: 'credit_note', invoice: inv(buyer, rate, price, supply) });

  test('⭐⭐⭐ ledger: a credit note REDUCES output tax — it is not another sale', () => {
    const led = T.ledger([sale('s1', { Pos: '33' }, 5, 1000, 'C1-0001'), ret('r1', { Pos: '33' }, 5, 200, 'CN-0001')], { RegType: 'regular' });
    assert.equal(led.output.taxable, 800, 'the return was added to sales, not taken off them');
    assert.equal(led.output.tax, 40);
    assert.equal(led.rows.find((r) => r.chit_id === 'r1').side, 'output_cn');
  });

  test('⭐ a supplier\'s credit note to me gives back input credit — ITC goes DOWN', () => {
    const buy = { chit_id: 'p1', direction: 'received', purpose: 'general', invoice: inv({ Gstin: '33M', Pos: '33' }, 18, 1000), provisional: false, seller: { entity_id: 'sup', RegType: 'regular' }, buyer: { entity_id: 'me' }, at: '2026-09-04' };
    const cn = Object.assign({}, buy, { chit_id: 'p2', purpose: 'credit_note', invoice: inv({ Gstin: '33M', Pos: '33' }, 18, 100) });
    const led = T.ledger([buy, cn], { RegType: 'regular' });
    assert.equal(led.itc.tax, 162); assert.equal(led.rows.find((r) => r.chit_id === 'p2').side, 'itc_cn');
  });

  test('⭐⭐ gstr1: a registered buyer\'s credit note → cdnr; a walk-in return nets off b2cs; B2C large inter-state → cdnur', () => {
    const led = T.ledger([
      sale('s1', { Pos: '33' }, 5, 1000, 'C1-0001'),
      sale('s2', { Pos: '33' }, 5, 500, 'C1-0002'),
      ret('r1', { Pos: '33' }, 5, 200, 'CN-0001'),                          /* a walk-in return: nets off b2cs */
      ret('r2', { Gstin: '29B', Pos: '29' }, 18, 300, 'CN-0002'),           /* to a registered buyer: cdnr */
      ret('r3', { Pos: '29' }, 18, 300000, 'CN-0003', 'inter'),            /* B2C large, inter-state: cdnur */
    ], { RegType: 'regular' });
    const g = T.gstr1(led, { Gstin: ME_GSTIN }, '092026');
    assert.equal(g.b2cs.length, 1); assert.equal(g.b2cs[0].txval, 1300, 'the walk-in return did not net off b2cs (1500 − 200)');
    assert.equal(g.cdnr.length, 1); assert.equal(g.cdnr[0].ctin, '29B'); assert.equal(g.cdnr[0].nt[0].ntty, 'C'); assert.equal(g.cdnr[0].nt[0].nt_num, 'CN-0002');
    assert.equal(g.cdnur.length, 1); assert.equal(g.cdnur[0].typ, 'B2CL');
    /* the engine's HSN summary is rate-wise (one row per HSN · UQC · rate, Table 12 since 2021), so the net is the sum over the rows */
    assert.equal(g.hsn.data.reduce((sum, h) => sum + h.txval, 0), 1500 - 200 - 300 - 300000, 'the HSN summary is not net of returns');
    const t13 = g.doc_issue.doc_det;
    /* the engine serials Table 13's natures in its own order (invoices, then notes); the portal's fixed serial for a credit note (5) is an engines request (ACC-225 follow-up) */
    assert.deepEqual(t13.map((d) => [d.doc_typ, d.docs[0].from, d.docs[0].to, d.docs[0].totnum]),
      [['Invoices for outward supply', 'C1-0001', 'C1-0002', 2], ['Credit Note', 'CN-0001', 'CN-0003', 3]], 'Table 13 does not list the invoices and credit notes issued');
  });
}

/* [TAX-03] regression: all_recipients lists the sender FIRST; the counterparty of a sent copy is the receiver. */
{
  const T = require('../lib/tax-lines');
  const assert = require('assert');
  const hdr = { sender_entity_id: 'S', all_recipients: [{ entity_id: 'S', role: 'sender' }, { entity_id: 'B', role: 'receiver' }, { entity_id: 'C', role: 'cc' }] };
  assert.strictEqual(T.otherPartyId(hdr, 'S'), 'B', 'sent → the receiver, not the sender entry');
  assert.strictEqual(T.otherPartyId(hdr, 'B'), 'S', 'received → the sender');
  assert.strictEqual(T.otherPartyId({ sender_entity_id: 'S', all_recipients: [{ entity_id: 'S', role: 'sender' }] }, 'S'), null, 'no receiver → null, never self');
  console.log('otherPartyId: 3 passed');
}

/* [TAX-03] regression: normalised slabs (an array of slabOf() output, or the Map) must rate a line the same way. */
{
  const T = require('../lib/tax-lines'); const S = require('../lib/tax-slab'); const assert = require('assert');
  const raw = [{ definition_id: 'IN-GST-18', name: 'GST 18%', rules: { rate: 18 } }];
  const items = [{ item_id: 'i1', item_data: { name: 'Rice', tax_slab: 'IN-GST-18' } }];
  const line = [{ name: 'Rice', quantity: 2, price: 1000 }];
  const map = S.indexSlabs(raw);
  assert.strictEqual(T.decorate(line, { items, slabs: raw })[0].gst_rate, 18, 'raw definitions');
  assert.strictEqual(T.decorate(line, { items, slabs: map })[0].gst_rate, 18, 'the Map');
  assert.strictEqual(T.decorate(line, { items, slabs: [...map.values()] })[0].gst_rate, 18, 'normalised array (the send path)');
  console.log('normalised slabs: 3 passed');
}

/* ACC-206 (critic 2 Nov): a list price the line does not GIVE (absent · null · blank) reaches the engine as NO list_price key — num() reads null and '' as 0,
   and a 0 list beside a negative price was the v1.75.0 bug; a given one (a number or a numeric string) rides as a number */
{
  const T = require('../lib/tax-lines'); const tax = require('../lib/tax'); const assert = require('assert');
  const real = tax.determine, seen = [];
  tax.determine = (input) => { seen.push(input.lines[0]); return real(input); };
  try {
    for (const list_price of [undefined, null, '', '  ']) T.invoiceFor({ lines: [{ name: 'x', quantity: 1, price: 10, list_price }], seller: { Country: 'AU' }, buyer: { Country: 'AU' } });
    T.invoiceFor({ lines: [{ name: 'x', quantity: 1, price: 10, list_price: '12.5' }], seller: { Country: 'AU' }, buyer: { Country: 'AU' } });
  } finally { tax.determine = real; }
  seen.slice(0, 4).forEach((line, at) => assert.ok(!('list_price' in line), 'case ' + at + ': no list_price key'));
  assert.strictEqual(seen[4].list_price, 12.5, 'a given list price rides as a number');
  console.log('list price presence: 5 passed');
}

/* the gate (scripts/guards.cjs) reads "<n> checks": the node:test cases declared above, plus the three plain blocks' 11 —
   printed AFTER the runner has finished, and a failing case still fails the file through its exit code */
require('node:test').after(() => {
  const declared = (require('fs').readFileSync(__filename, 'utf8').match(/^\s*test\('/gm) || []).length;
  console.log('  ' + (declared + 11) + ' checks');
});
