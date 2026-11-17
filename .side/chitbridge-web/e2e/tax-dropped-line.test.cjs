'use strict';
// @type: unit
/**
 * tax-dropped-line.test.cjs: the Tax month says WHY it is short (api #1180: GET /api/tax/ledger sends `dropped` + `dropped_why`).
 * CARD 18-reports/mis-tax · owns: the proof that the REAL misTax() renders the line and that Open reaches openChit with that bill's id · called by: ci.yml
 * misTax (cap-admin.js) and the real tx/txn/txf/errWords run in a sandbox; the page is the string misTax returns, and the "click" runs the very
 * onclick the Open button carries. Fails on main (misTax paints no such line).
 *   1. one dropped bill: the count sentence, the api's reason on its own line, an Open that is a real <button> carrying CMP010
 *   2. clicking that Open calls openChit with THAT bill's id; the person is never shown the id (no uuid in the text)
 *   3. an older api (no keys) paints nothing and does not throw
 *   4. the count sentence goes through the pack (fr), the api's English reason stays as sent
 * Run: node e2e/tax-dropped-line.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'public', rel), 'utf8');
/** one top-level function declaration, by name (ends at the first closing brace in column 0) */
const fnSrc = (src, name) => {
  const heads = ['function ' + name + '(', 'async function ' + name + '('];
  const at = Math.max(...heads.map((h) => { const i = src.indexOf('\n' + h); return i < 0 ? -1 : i + 1; }));
  assert(at >= 0, name + ' is missing');
  return src.slice(at, src.indexOf('\n}\n', at) + 3);
};
const admin = read('app/cap-admin.js');
const shell = read('app/accounts-shell.js');
const core = read('app/core.js');

const UUID = '0d102689-4f3a-4c2b-9a51-77aa31c0de01';
let lang = 'en';
const box = {
  console, JSON, Date, Intl, Array, Object, Number, String,
  CBSTR: { en: {}, fr: {} }, cbLang: () => lang, CBLocale: { locale: () => lang, number: (x) => String(x) }, bidiWrap: (x) => x,
  UI: { _taxMonth: '2026-11' }, SESSION: { country: 'IN' }, inr: (x) => String(x), _misBack: () => '',
  esc: (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';')
};
vm.createContext(box);
['tx', 'txf', 'txn'].forEach((n) => vm.runInContext(fnSrc(shell, n), box));
vm.runInContext(fnSrc(core, 'errWords'), box);
['_misHead', 'misTaxMonth', 'taxDroppedHTML', 'misTax'].forEach((n) => vm.runInContext(fnSrc(admin, n), box));
const money = { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
const ledger = (extra) => Object.assign({ month: '2026-11', registration: 'regular', output: money, itc: money, net: { total: 0, cgst: 0, sgst: 0, igst: 0 }, rows: [], count: 0 }, extra);
const render = (extra) => { box.UI._taxLedger = ledger(extra); return vm.runInContext('misTax()', box); };

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const plain = (h) => h.replace(/<[^>]*>/g, ' ');

t('one dropped bill: the count sentence, the reason on its own line, a real Open button with its code', () => {
  const h = render({ dropped: [UUID], dropped_why: ['The bill has no amount we can read.'] });
  assert(h.includes('1 bill could not be read and is left out of this month'), h);
  assert(/data-testid="mis-tax-dropped-why">The bill has no amount we can read\.</.test(h), 'the reason is its own line');
  assert(/<button data-cbsid="CMP010"[^>]*data-testid="mis-tax-dropped-open-0"/.test(h), 'Open is a real button with CMP010');
});
t('clicking Open calls openChit with that bill\'s id; no id is shown as text', () => {
  const ids = [UUID, 'c-2'];
  const h = render({ dropped: ids, dropped_why: 'x' });
  ids.forEach((id, i) => {
    const m = new RegExp('data-testid="mis-tax-dropped-open-' + i + '"[^>]*onclick="([^"]*)"').exec(h);
    assert(m, 'Open ' + i + ' has no onclick');
    const calls = [];
    vm.runInNewContext(m[1].replace(/&#39;/g, "'"), { openChit: (x) => calls.push(x) });
    assert.deepStrictEqual(calls, [id], 'Open ' + i + ' opens ' + id);
  });
  assert(!plain(h).includes(UUID) && /Open bill 1/.test(h) && /Open bill 2/.test(h), 'the label names the bill by number, never the id');
});
t('an older api (no keys) or an empty list paints no such line', () => {
  assert(!render({}).includes('mis-tax-dropped'));
  assert(!render({ dropped: [] }).includes('mis-tax-dropped'));
});
t('the count sentence follows the language pack; the api reason stays as sent', () => {
  vm.runInContext(read('app/strings-fr.js'), box); /* the REAL pack, so a mistyped key fails here */
  lang = 'fr';
  const h = render({ dropped: ['a'], dropped_why: ['English from the api.'] });
  lang = 'en';
  assert(h.includes('1 facture illisible, exclue de ce mois') && h.includes('English from the api.'), h);
});
console.log(pass + ' passed');
