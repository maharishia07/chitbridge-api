/* A VAT-type scheme (b202: DE-VAT-19 …) goes through the SAME engine as GST: one head, border decides. */
const assert = require('assert');
const tax = require('../lib/tax');
const lines = require('../lib/tax-lines');
const slab = require('../lib/tax-slab');
let n = 0, f = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { f++; console.log('FAIL', name, e.message); } };

t('domestic VAT: one head, GST heads 0', () => {
  const v = tax.determine({ seller: { Country: 'DE' }, buyer: { Country: 'de' }, lines: [{ qty: 2, price: 100, rate: 19, tax_scheme: 'VAT' }] });
  const it = v.ItemList[0];
  assert.strictEqual(it.TaxAmt, 38); assert.strictEqual(it.CgstAmt + it.SgstAmt + it.IgstAmt, 0);
  assert.strictEqual(v.ValDtls.TaxVal, 38); assert.strictEqual(v.ValDtls.TotInvVal, 238);
  assert.strictEqual(v.TranDtls.TaxSch, 'VAT'); assert.strictEqual(v._cb.supply, 'domestic');
});
t('cross-border B2B: nothing charged, the rate stays on the line, a note says why', () => {
  const v = tax.determine({ scheme: 'VAT', seller: { Country: 'DE' }, buyer: { Country: 'FR' }, lines: [{ qty: 1, price: 100, rate: 19 }] });
  assert.strictEqual(v.ItemList[0].TaxAmt, 0); assert.strictEqual(v.ItemList[0].GstRt, 19);
  assert.strictEqual(v.ValDtls.TotInvVal, 100); assert.strictEqual(v._cb.supply, 'cross');
  assert.ok(v._cb.notes.some((x) => /Cross-border/.test(x)));
});
t('no country → unknown, nothing assumed', () => {
  const v = tax.determine({ scheme: 'VAT', seller: { Country: 'DE' }, buyer: {}, lines: [{ qty: 1, price: 100, rate: 19 }] });
  assert.strictEqual(v._cb.supply, 'unknown'); assert.strictEqual(v.ValDtls.TaxVal, 0);
  assert.ok(v._cb.notes.some((x) => /no country/.test(x)));
});
t('discount first under VAT too', () => {
  const v = tax.determine({ scheme: 'VAT', seller: { Country: 'FR' }, buyer: { Country: 'FR' }, lines: [{ qty: 1, price: 100, discount: 20, rate: 20 }] });
  assert.strictEqual(v.ItemList[0].AssAmt, 80); assert.strictEqual(v.ItemList[0].TaxAmt, 16);
});
t('GST is untouched: TaxVal 0, TaxSch GST, split by state', () => {
  const v = tax.determine({ seller: { State: '29' }, buyer: { Pos: '27' }, lines: [{ qty: 1, price: 100, rate: 18 }] });
  assert.strictEqual(v.ValDtls.TaxVal, 0); assert.strictEqual(v.ValDtls.IgstVal, 18); assert.strictEqual(v.TranDtls.TaxSch, 'GST');
});
t('the slab carries its scheme through resolve → decorate → invoiceFor → heads', () => {
  const slabs = [{ definition_id: 'DE-VAT-19', name: 'VAT 19%', rules: { rate: 19, scheme: 'VAT' } }];
  const r = slab.resolve({ item_data: { tax_slab: 'DE-VAT-19' }, slabs });
  assert.strictEqual(r.scheme, 'VAT');
  const items = [{ item_id: 'i1', item_data: { name: 'Widget', tax_slab: 'DE-VAT-19' } }];
  const dec = lines.decorate([{ item_id: 'i1', name: 'Widget', quantity: 1, price: 100 }], { items, slabs });
  assert.strictEqual(dec[0].tax_scheme, 'VAT'); assert.strictEqual(dec[0].gst_rate, 19);
  const inv = lines.invoiceFor({ lines: dec, seller: { Country: 'DE' }, buyer: { Country: 'DE' } });
  const h = lines.heads(inv.invoice);
  assert.strictEqual(h.vat, 19); assert.strictEqual(h.tax, 19); assert.strictEqual(h.total, 119);
});
t('a GST slab resolves scheme GST by default', () => {
  const r = slab.resolve({ item_data: { tax_slab: 'x' }, slabs: [{ definition_id: 'x', rules: { rate: 18 } }] });
  assert.strictEqual(r.scheme, 'GST');
});
console.log(`tax-scheme: ${n} passed, ${f} failed`); process.exit(f ? 1 : 0);
