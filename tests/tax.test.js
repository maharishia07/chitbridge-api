'use strict';
/**
 * tax.test.js — GST determination: two addresses in, INV-01 vocabulary out.
 *
 * ⚠️ THE TESTS THAT EARN THEIR KEEP ARE THE COMPLIANCE ONES, NOT THE ARITHMETIC. A wrong total is visible; the
 * wrong tax HEAD, or tax charged on a pre-discount value, is a correct-looking invoice that is wrong in a way
 * only a return discovers.
 */
const assert = require('assert');
const T = require('../lib/tax');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}

const SELLER = { Gstin: '29ABCDE1234F1Z5', LglNm: 'Alpha Traders', State: '29', Loc: 'Bengaluru', Pin: 560001 };
const LINE = { id: 'L1', name: 'Tea, 250g', hsn: '09024090', qty: 10, unit_price: 180, rate: 5, unit: 'PAC' };

console.log('\ntax · the one decision GST turns on');

t('⭐⭐ same state → CGST + SGST, and no IGST', () => {
  const r = T.determine({ seller: SELLER, buyer: { Gstin: '29ZZZZZ1234F1Z5', State: '29', Pos: '29' }, lines: [LINE] });
  const it = r.ItemList[0];
  assert.strictEqual(r._cb.supply, 'intra');
  assert.strictEqual(it.IgstAmt, 0);
  assert.strictEqual(r2(it.CgstAmt + it.SgstAmt), 90, '5% of 1800');
});

t('⭐⭐ another state → IGST, and no CGST/SGST — same goods, same price', () => {
  const r = T.determine({ seller: SELLER, buyer: { Gstin: '27ZZZZZ1234F1Z5', State: '27', Pos: '27' }, lines: [LINE] });
  const it = r.ItemList[0];
  assert.strictEqual(r._cb.supply, 'inter');
  assert.strictEqual(it.IgstAmt, 90);
  assert.strictEqual(it.CgstAmt, 0);
  assert.strictEqual(it.SgstAmt, 0);
});

t('⚠️ PLACE OF SUPPLY beats the buyer\'s address — a Karnataka buyer, delivered to Maharashtra, is IGST', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '29', Pos: '27' }, lines: [LINE] });
  assert.strictEqual(r._cb.supply, 'inter', 'the delivery state decides, not where the buyer is registered');
  assert.strictEqual(r.ItemList[0].IgstAmt, 90);
});

t('⚠️ NO PLACE OF SUPPLY IS AN ANSWER — nothing is assumed, and it says so', () => {
  const r = T.determine({ seller: { LglNm: 'X' }, buyer: {}, lines: [LINE] });
  assert.strictEqual(r._cb.supply, 'unknown');
  assert.strictEqual(r.ItemList[0].IgstAmt + r.ItemList[0].CgstAmt + r.ItemList[0].SgstAmt, 0);
  assert.ok(/cannot be decided/i.test(r._cb.notes.join(' ')), 'silence here is how the wrong tax gets charged');
});

t('a missing Pos falls back to the buyer state, and SAYS it fell back', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '27' }, lines: [LINE] });
  assert.strictEqual(r._cb.place_of_supply, '27');
  assert.ok(/place of supply was not given/i.test(r._cb.notes.join(' ')));
});

t('a leading zero in a state code is not lost', () => {
  assert.strictEqual(T.supplyType('07', '7'), 'intra');
  assert.strictEqual(T.supplyType('09', '07'), 'inter');
});

console.log('\ntax · order of operations');

t('⭐⭐ DISCOUNT FIRST, TAX ON WHAT REMAINS', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '29', Pos: '29' },
    lines: [{ ...LINE, discount: 300 }] });
  const it = r.ItemList[0];
  assert.strictEqual(it.TotAmt, 1800);
  assert.strictEqual(it.AssAmt, 1500, 'the taxable value is after the discount');
  assert.strictEqual(r2(it.CgstAmt + it.SgstAmt), 75, '5% of 1500, not of 1800');
});

t('⭐ INCLUSIVE PRICING is declared and worked backwards, never guessed', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '29', Pos: '29' },
    priceIncludesTax: true, lines: [{ ...LINE, qty: 1, unit_price: 105, rate: 5 }] });
  const it = r.ItemList[0];
  assert.strictEqual(it.AssAmt, 100, '105 inclusive of 5% is 100 taxable');
  assert.strictEqual(r2(it.CgstAmt + it.SgstAmt), 5);
  assert.strictEqual(it.TotItemVal, 105, 'the customer still pays 105');
});

t('the same price NOT declared inclusive is taxed on top — the 5% difference', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '29', Pos: '29' },
    lines: [{ ...LINE, qty: 1, unit_price: 105, rate: 5 }] });
  assert.strictEqual(r.ItemList[0].TotItemVal, 110.25);
});

console.log('\ntax · INV-01 vocabulary');

t('⭐ the shape a buyer\'s system already speaks', () => {
  const r = T.determine({ seller: SELLER, buyer: { Gstin: '27A', State: '27', Pos: '27' }, lines: [LINE] });
  for (const k of ['TranDtls', 'SellerDtls', 'BuyerDtls', 'ItemList', 'ValDtls']) {
    assert.ok(r[k], 'missing group ' + k);
  }
  for (const k of ['SlNo', 'PrdDesc', 'IsServc', 'HsnCd', 'Qty', 'Unit', 'UnitPrice', 'TotAmt',
                   'Discount', 'AssAmt', 'GstRt', 'IgstAmt', 'CgstAmt', 'SgstAmt', 'TotItemVal']) {
    assert.ok(k in r.ItemList[0], 'missing item field ' + k);
  }
  for (const k of ['AssVal', 'CgstVal', 'SgstVal', 'IgstVal', 'RndOffAmt', 'TotInvVal']) {
    assert.ok(k in r.ValDtls, 'missing ValDtls field ' + k);
  }
});

t('⚠️ seller/buyer carry `State`, NOT `Stcd` — verified against the schema, not remembered', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '27', Pos: '27' }, lines: [LINE] });
  assert.strictEqual(r.SellerDtls.State, '29');
  assert.strictEqual(r.SellerDtls.Stcd, undefined, 'Stcd exists only in DispDtls/ShipDtls');
});

t('B2B vs B2C is decided by whether the buyer is registered', () => {
  assert.strictEqual(T.determine({ seller: SELLER, buyer: { Gstin: '27A', Pos: '27' }, lines: [LINE] }).TranDtls.SupTyp, 'B2B');
  assert.strictEqual(T.determine({ seller: SELLER, buyer: { Pos: '27' }, lines: [LINE] }).TranDtls.SupTyp, 'B2C');
});

console.log('\ntax · rounding and reverse charge');

t('⭐⭐ ROUNDED ONCE AT THE INVOICE, and the round-off is DECLARED', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '27', Pos: '27' },
    lines: [{ ...LINE, qty: 3, unit_price: 99.99, rate: 18 }] });
  const v = r.ValDtls;
  assert.strictEqual(v.TotInvVal, Math.round(v.TotInvVal), 'the payable is a whole rupee');
  assert.strictEqual(T.r2(v.AssVal + v.IgstVal + v.RndOffAmt), v.TotInvVal,
    'the round-off must reconcile — a paise gap is why a counterparty rejects an invoice');
});

t('totals are grouped per rate slab', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '27', Pos: '27' },
    lines: [{ ...LINE, rate: 5 }, { ...LINE, id: 'L2', rate: 18 }] });
  assert.strictEqual(r._cb.slabs.length, 2);
  assert.deepStrictEqual(r._cb.slabs.map((s) => s.GstRt).sort((a, b) => a - b), [5, 18]);
});

t('⚠️ REVERSE CHARGE: the tax is STATED but not collected', () => {
  const r = T.determine({ seller: SELLER, buyer: { Gstin: '27A', State: '27', Pos: '27' },
    reverseCharge: true, lines: [LINE] });
  assert.strictEqual(r.TranDtls.RegRev, 'Y');
  assert.strictEqual(r.ValDtls.IgstVal, 90, 'the buyer needs the amount to self-assess');
  assert.strictEqual(r._cb.amount_payable, 1800, 'but only the taxable value is payable to the seller');
  assert.ok(/buyer accounts for the tax/i.test(r._cb.notes.join(' ')));
});

t('CGST and SGST always sum to the tax — an odd rate cannot lose a paisa', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '29', Pos: '29' },
    lines: [{ ...LINE, qty: 1, unit_price: 33.33, rate: 5 }] });
  const it = r.ItemList[0];
  assert.strictEqual(T.r2(it.CgstAmt + it.SgstAmt), T.r2(it.AssAmt * 5 / 100));
});

console.log('\ntax · the provider seam');

t('⭐ the seam matches ITaxProvider — a real provider is a drop-in', () => {
  assert.strictEqual(T.systemProvider.getIdentifier(), 'cb_system');
  const lines = T.systemProvider.getTaxLines([LINE], { seller: SELLER, buyer: { State: '27', Pos: '27' } });
  assert.strictEqual(lines[0].line_item_id, 'L1');
  assert.strictEqual(lines[0].rate, 5);
  assert.strictEqual(lines[0].name, 'IGST');
  assert.strictEqual(lines[0].provider_id, 'cb_system');
});

t('⚠️⚠️ THE DEFAULT PROVIDER SHIPS NO RATES — a line with no rate is taxed at nothing, silently to nobody', () => {
  const r = T.determine({ seller: SELLER, buyer: { State: '27', Pos: '27' },
    lines: [{ ...LINE, rate: undefined }] });
  assert.strictEqual(r.ItemList[0].IgstAmt, 0,
    'a stale rate table in our repo would be a compliance liability; the rate comes from the catalogue or a provider');
});

function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
