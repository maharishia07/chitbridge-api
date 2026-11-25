'use strict';
/* rw1ctr (re-walk 1, RW1-19/20, retest B-F-22): the till's words follow the shop's country; the owner from app.html may rate; an empty shelf points on */
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const lift = (name) => { const at = html.indexOf('function ' + name + '()'); assert.ok(at >= 0, name); return html.slice(at, html.indexOf(String.fromCharCode(10), at)).replace(/\r$/, ''); };
function ctx(country, extra) {
  const c = vm.createContext(Object.assign({ S: { shop: { country } } }, extra || {}));
  vm.runInContext(['function docCountry(){ return (S && S.shop && S.shop.country) || null; }',
    'function countryWords(){ return {}; }', 'function taxIdLabel(){ return (S.shop.tax_id_word) || "Tax number"; }',
    lift('shopTaxWord'), lift('minorUnitWord')].join('\n'), c);
  return c;
}
test('RW1-19: GSTIN and paise only on an Indian counter', () => {
  const au = ctx('AU'), inn = ctx('IN', { S: { shop: { country: 'IN', tax_id_word: 'GSTIN' } } });
  assert.strictEqual(inn.shopTaxWord(), 'GSTIN');
  assert.ok(!/GSTIN/.test(au.shopTaxWord())); assert.ok(!/paise/.test(au.minorUnitWord())); assert.ok(!/paise/.test(inn.minorUnitWord()));
  assert.ok(!/GSTIN/.test(ctx(null).shopTaxWord()));
});
test('RW1-19: UPI row, hint and option are behind packHasUpi', () => {
  assert.ok(/id="row_upi"/.test(html) && /el\.hidden = !upiOn/.test(html));
  assert.ok(!/try &quot;upi&quot;/.test(html));
  assert.ok(/packHasUpi\(\) \? '<option value="upi">/.test(html));
  assert.ok(!/send a KOT (F3)/.test(html));
});
test('B-F-22: person.kind owner (app.html) and entity (till login) both rate', () => {
  assert.ok(/owner: person\.kind === 'entity' \|\| person\.kind === 'owner'/.test(html));
});
test('RW1-20: an empty catalogue says what to do, not "Nothing matches"', () => {
  assert.ok(/catalogueTotal\(\) \? tx\('Nothing matches\.'\) : \(tx\('Nothing to sell yet/.test(html));
});
