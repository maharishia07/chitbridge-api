'use strict';
/**
 * acc-220-cess-undecided.test.cjs — ACC-220: THE CESS WAITS WHEN THE SUPPLY IS UNDECIDED.
 * With no place of supply the GST heads are held at 0 ("nothing was assumed", ACC-191); the compensation cess was still charged, and on a
 * tax-inclusive price the line went above the price shown (100 shown, 112 billed). A cess is levied only where a GST head is.
 * Expected figures are hand-computed. IN: seller 29 (Karnataka). AU has no cess; its line must be unchanged.
 */
const assert = require('assert');
const vm = require('vm'), fs = require('fs'), path = require('path');
/* the SAME engine in its two api copies: lib/tax.js (the server's require) and lib/tax-engine.browser.js (the bundle the counter loads).
   Both are adopted copies of chitbridge-engines src/tax.js; the duplicate retires when the engines fix (engines PR#102) is adopted. */
const page = {}; vm.createContext(page); vm.runInContext('var window = globalThis;', page);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'tax-engine.browser.js'), 'utf8'), page);
const COPIES = { 'lib/tax.js': require('../lib/tax'), 'lib/tax-engine.browser.js': page.CBTax };
let T;
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}
const seller = { Gstin: '29ABCDE1234F1Z5', State: '29', Country: 'IN' };
const line = { id: 'L1', name: 'Soda', qty: 1, unit_price: 100, rate: 5, cess_rate: 12 };
const run = (buyer, inc) => T.determine({ seller, buyer, lines: [line], priceIncludesTax: inc });
const gst = (v) => v.CgstVal + v.SgstVal + v.IgstVal;

for (const [copy, engine] of Object.entries(COPIES)) {
T = engine;
console.log(copy + ' · the cess waits with the GST heads (ACC-220)');
for (const inc of [true, false]) {
  const w = inc ? 'inclusive' : 'exclusive';
  t('IN place of supply unknown, ' + w + ': GST 0, cess 0, total 100', () => {
    const inv = run({ Country: 'IN' }, inc), v = inv.ValDtls, it = inv.ItemList[0];
    assert.strictEqual(inv._cb.supply, 'unknown');
    assert.strictEqual(gst(v), 0); assert.strictEqual(v.CesVal, 0); assert.strictEqual(it.CesAmt, 0);
    assert.strictEqual(v.TotInvVal, 100);
  });
}
t('IN inter-state (27), inclusive: IGST 5 on 100 at 117% -> price 100 = taxable 85.47, IGST 4.27, cess 10.26', () => {
  const v = run({ State: '27', Pos: '27', Country: 'IN' }, true).ValDtls;
  assert.strictEqual(v.IgstVal, 4.27); assert.strictEqual(v.CesVal, 10.26); assert.strictEqual(v.TotInvVal, 100);
});
t('IN intra-state (29), inclusive: CGST 2.14 + SGST 2.14, cess 10.26, total 100', () => {
  const v = run({ State: '29', Pos: '29', Country: 'IN' }, true).ValDtls;
  assert.strictEqual(v.CgstVal, 2.14); assert.strictEqual(v.SgstVal, 2.14); assert.strictEqual(v.CesVal, 10.26); assert.strictEqual(v.TotInvVal, 100);
});
t('IN inter-state (27), exclusive: IGST 5, cess 12, total 117', () => {
  const v = run({ State: '27', Pos: '27', Country: 'IN' }, false).ValDtls;
  assert.strictEqual(v.IgstVal, 5); assert.strictEqual(v.CesVal, 12); assert.strictEqual(v.TotInvVal, 117);
});
t('IN intra-state (29), exclusive: CGST 2.5 + SGST 2.5, cess 12, total 117', () => {
  const v = run({ State: '29', Pos: '29', Country: 'IN' }, false).ValDtls;
  assert.strictEqual(v.CgstVal, 2.5); assert.strictEqual(v.CesVal, 12); assert.strictEqual(v.TotInvVal, 117);
});
t('splitLineTax told "unknown": cess 0; told "inter": cess charged; not told: cess charged (callers that never pass a supply keep their answer)', () => {
  const base = { net: 100, rate: 5, cessRate: 12, priceIncludesTax: false };
  assert.strictEqual(T.splitLineTax(Object.assign({ supply: 'unknown' }, base)).cess, 0);
  assert.strictEqual(T.splitLineTax(Object.assign({ supply: 'inter' }, base)).cess, 12);
  assert.strictEqual(T.splitLineTax(base).cess, 12);
});
t('AU domestic and AU unknown-country buyer: no cess on the line, the AU answer is unchanged (GST 10 on 100 exclusive)', () => {
  const v = T.determine({ seller: { Country: 'AU', LglNm: 'Mayur Deli' }, buyer: { Country: 'AU' }, lines: [{ id: 'A', name: 'x', qty: 1, unit_price: 100, rate: 10 }], priceIncludesTax: false }).ValDtls;
  assert.strictEqual(v.CesVal, 0); assert.strictEqual(v.TotInvVal, 110);
});
t('AU line given a cess rate on a decided domestic supply is levied as before (the pack, not this fix, decides cess exists)', () => {
  const v = T.determine({ seller: { Country: 'AU', LglNm: 'Mayur Deli' }, buyer: { Country: 'AU' }, lines: [{ id: 'A', name: 'x', qty: 1, unit_price: 100, rate: 10, cess_rate: 0 }], priceIncludesTax: true }).ValDtls;
  assert.strictEqual(v.TotInvVal, 100);
});
}
console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '') + pass + ' passed');
process.exit(fail ? 1 : 0);
