// tests/tax-lines.test.js — the engine reaches the chit: lines rated at send, the invoice per copy, the month's ledger.
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

test('gstr1 groups B2B by counterparty GSTIN and B2C by place-of-supply + rate; gstr3b carries the totals and says it is provisional', () => {
  const inv = (buyer, rate) => T.invoiceFor({ lines: [{ name: 'x', quantity: 1, price: 100, gst_rate: rate, hsn: '1006' }], seller: { Gstin: '33S', State: '33' }, buyer, chit_id: 'c1', at: '2026-09-04' }).invoice;
  const led = T.ledger([
    { chit_id: 'a', direction: 'sent', invoice: inv({ Gstin: '29B', Pos: '29' }, 18), provisional: true, seller: { entity_id: 'me' }, buyer: { entity_id: 'b' }, at: '2026-09-04' },
    { chit_id: 'b', direction: 'sent', invoice: inv({ Pos: '33' }, 5), provisional: false, seller: { entity_id: 'me' }, buyer: { entity_id: 'c' }, at: '2026-09-04' },
  ], { RegType: 'regular' });
  const g1 = T.gstr1(led, { Gstin: '33S' }, '092026');
  assert.equal(g1.b2b.length, 1); assert.equal(g1.b2b[0].ctin, '29B'); assert.equal(g1.b2b[0].inv[0].itms[0].itm_det.iamt, 18);
  assert.equal(g1.b2cs.length, 1); assert.equal(g1.b2cs[0].camt, 2.5);
  assert.equal(g1.hsn.data[0].hsn_sc, '1006');
  const g3 = T.gstr3b(led, { Gstin: '33S' }, '092026');
  assert.equal(g3.sup_details.osup_det.iamt, 18); assert.equal(g3._cb.provisional, true);
});
