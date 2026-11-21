/**
 * tests/till2-buyer-tax-field-1128.test.cjs — batch 1128 fixTill2 item 1 (UAE I-F-03): the till's optional BUYER tax-number box.
 * @type regression
 * OWNS      the box (#cgstin, data-testid till-buyer-tax-id, data-cbsid CTR002-I14, register path Counter > Page header, search and bill) and its functions in tools/tally-connector/till.html,
 *           lifted into a vm: the label is the pack's word (taxIdLabel), the format check is the country pack's (AE TRN 15 digits, AU ABN checksum via CBCountries.taxId; IN the
 *           GSTIN checksum), a passing number rides business_json.customer.gstin (billCustomerOf), a failing one is SAID and not carried, a blank adds nothing, the next bill starts clean.
 * CALLED BY the api test run. No browser, no database.
 *   node tests/till2-buyer-tax-field-1128.test.cjs
 */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const HTML = fs.readFileSync(path.join(__dirname, '../tools/tally-connector/till.html'), 'utf8').replace(/\r\n/g, '\n');
const PMAP = require('../lib/profile-map');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
function grab(name) {
  const at = HTML.indexOf('\nfunction ' + name + '(');
  if (at < 0) return '';
  let i = HTML.indexOf('{', at), depth = 0;
  for (; i < HTML.length; i++) { if (HTML[i] === '{') depth++; else if (HTML[i] === '}' && --depth === 0) break; }
  return HTML.slice(at, i + 1);
}
ok('the control is in the page with its test id, register code and the pack word', () => {
  assert(/<input id="cgstin" data-testid="till-buyer-tax-id"[^>]*data-cbsid="CTR002-I14"/.test(HTML));
  assert(/paintBuyerTax\(\)/.test(HTML) && /taxIdLabel\(\)/.test(grab('paintBuyerTax')));
});
function page(country, typed, cust) {
  const box = { cgstin: { value: typed, placeholder: '', setAttribute() {} }, cgstinsay: { hidden: true, textContent: '' }, cname: { value: 'Acme' }, cphone: { value: '' } };
  const ABN = (v) => (/^\d{11}$/.test(v) ? { ok: true } : { ok: false, why: 'That is not the shape of an ABN.' });
  const TRN = (v) => (/^\d{15}$/.test(v) ? { ok: true } : { ok: false, why: 'A TRN is 15 digits.' });
  const ctx = {
    console, String, Number, Object, RegExp, CBProfileMap: PMAP, cbQuiet() {}, CART: [], price() {}, S: { shop: {} },
    window: { CBProfileMap: PMAP, CBCountries: { taxId: (c) => (c === 'AE' ? { word: 'TRN', check: TRN } : c === 'AU' ? { word: 'ABN', check: ABN } : null) } },
    tx: (e) => e, txf: (e, v) => String(e).replace(/\{(\w+)\}/g, (w, k) => (v && k in v ? v[k] : w)), docCountry: () => country, taxIdLabel: () => (country === 'AE' ? 'TRN' : country === 'AU' ? 'ABN' : 'GSTIN'),
    fieldVal: (id) => String((box[id] || {}).value || ''), invoiceRule: () => ({ b2b: true }),
    document: { getElementById: (id) => box[id] || null }, box
  };
  ctx.registryTaxId = () => ctx.window.CBCountries.taxId(country);
  vm.createContext(ctx);
  vm.runInContext(['buyerTaxCheck', 'paintBuyerTax', 'clearBuyerTax', 'billCustomerOf'].map(grab).join('\n') + '\nthis.__f = { paintBuyerTax, clearBuyerTax, billCustomerOf, buyerTaxCheck };', ctx);
  ctx.paintBuyerTax();
  return ctx;
}
ok('AE: a 15-digit TRN passes and rides business_json.customer.gstin', () => {
  const p = page('AE', '100123456700003'); assert.strictEqual(p.__f.billCustomerOf(null, 10000).gstin, '100123456700003'); assert.strictEqual(p.box.cgstin.placeholder, 'Buyer TRN');
});
ok('AE: a short TRN is said beside the box and NOT carried', () => {
  const p = page('AE', '1234'); assert(p.box.cgstinsay.hidden === false && /15 digits/.test(p.box.cgstinsay.textContent)); assert.strictEqual(p.__f.billCustomerOf(null, 1).gstin, undefined);
});
ok('AU: the ABN check is the pack\'s (11 digits)', () => {
  assert.strictEqual(page('AU', '51824753556').__f.billCustomerOf(null, 1).gstin, '51824753556'); assert.strictEqual(page('AU', '5182').__f.billCustomerOf(null, 1).gstin, undefined);
});
ok('IN: the GSTIN checksum decides (no registry row)', () => {
  assert.strictEqual(page('IN', '29AABCU9603R1ZJ').__f.billCustomerOf(null, 1).gstin, '29AABCU9603R1ZJ'); assert.strictEqual(page('IN', '29AABCU9603R1ZK').__f.billCustomerOf(null, 1).gstin, undefined);
});
ok('blank adds nothing; the next bill starts clean', () => {
  const p = page('AE', ''); assert.strictEqual(p.__f.billCustomerOf(null, 1).gstin, undefined);
  const q = page('AE', '100123456700003'); q.__f.clearBuyerTax(); assert.strictEqual(q.box.cgstin.value, ''); assert.strictEqual(q.window.BUYER_TAX_TYPED, ''); assert.strictEqual(q.__f.billCustomerOf(null, 1).gstin, undefined);
});
ok('the bill end clears it, guarded for lifted harnesses', () => {
  assert(/if \(typeof clearBuyerTax === 'function'\) clearBuyerTax\(\);/.test(grab('finish') || HTML));
});
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
