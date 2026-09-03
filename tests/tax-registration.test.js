// tests/tax-registration.test.js — registration type decides what an invoice may charge (STUDY §6 G2).
const test = require('node:test');
const assert = require('node:assert/strict');
const tax = require('../lib/tax');

const line = { name: 'Rice', qty: 2, unit_price: 100, rate: 18 };

test('regular ↔ regular: B2B, tax charged, heads split by place of supply', () => {
  const r = tax.determine({ seller: { Gstin: '33AAAAA0000A1Z5', State: '33' }, buyer: { Gstin: '29BBBBB0000B1Z5', Pos: '29' }, lines: [line] });
  assert.equal(r.TranDtls.SupTyp, 'B2B');
  assert.equal(r.ItemList[0].IgstAmt, 36);
  assert.equal(r.ValDtls.TotInvVal, 236);
});

test('⭐ a COMPOSITION seller charges no GST — the rate is recorded, every head is zero, the total is the taxable value', () => {
  const r = tax.determine({ seller: { Gstin: '33AAAAA0000A1Z5', State: '33', RegType: 'composition' }, buyer: { Gstin: '33BBBBB0000B1Z5', Pos: '33' }, lines: [line] });
  const it = r.ItemList[0];
  assert.equal(it.GstRt, 18, 'the slab rate stays on the line for the books');
  assert.equal(it.CgstAmt, 0); assert.equal(it.SgstAmt, 0); assert.equal(it.IgstAmt, 0);
  assert.equal(r.ValDtls.TotInvVal, 200);
  assert.ok(r._cb.notes.some((n) => /composition/i.test(n)));
});

test('⭐ a supply to an SEZ buyer is zero-rated: SupTyp SEZWOP, no tax, rate stated', () => {
  const r = tax.determine({ seller: { Gstin: '33AAAAA0000A1Z5', State: '33' }, buyer: { Gstin: '27CCCCC0000C1Z5', Pos: '27', RegType: 'sez' }, lines: [line] });
  assert.equal(r.TranDtls.SupTyp, 'SEZWOP');
  assert.equal(r.ItemList[0].IgstAmt, 0);
  assert.equal(r.ItemList[0].GstRt, 18);
  assert.equal(r.ValDtls.TotInvVal, 200);
  assert.ok(r._cb.notes.some((n) => /SEZ/.test(n)));
});

test('an UNREGISTERED buyer is B2C even if a GSTIN string is present, and is still charged tax', () => {
  const r = tax.determine({ seller: { Gstin: '33AAAAA0000A1Z5', State: '33' }, buyer: { Gstin: 'stale', Pos: '33', RegType: 'unregistered' }, lines: [line] });
  assert.equal(r.TranDtls.SupTyp, 'B2C');
  assert.equal(r.ItemList[0].CgstAmt, 18);
});

test('the flag name variants are all read (RegType · reg_type · gst_registration), absent = regular', () => {
  const a = tax.determine({ seller: { State: '33', gst_registration: 'composition' }, buyer: { Pos: '33' }, lines: [line] });
  const b = tax.determine({ seller: { State: '33', reg_type: 'composition' }, buyer: { Pos: '33' }, lines: [line] });
  const c = tax.determine({ seller: { State: '33' }, buyer: { Pos: '33' }, lines: [line] });
  assert.equal(a.ValDtls.TotInvVal, 200); assert.equal(b.ValDtls.TotInvVal, 200); assert.equal(c.ValDtls.TotInvVal, 236);
});
