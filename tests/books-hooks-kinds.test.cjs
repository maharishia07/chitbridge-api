'use strict';
/**
 * books-hooks-kinds.test.cjs — A5 (engines v1.64.0): the api's byRateOf keeps a line's supply kind, so GST-free and input-taxed sales (both 0%)
 * reach posting as two rows and land on their own sales ledgers (BAS G3 / VAT201 boxes 4–5). An invoice whose lines name no kind is unchanged.
 */
const assert = require('assert');
const T = require('../lib/tax'), H = require('../lib/books-hooks');
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
const inv = (lines) => T.determine({ seller: { Country: 'AU' }, buyer: { Country: 'AU', RegType: 'unregistered' }, lines });

it('two kinds at one rate stay two rows, each naming its kind; the taxed line keeps no kind', () => {
  const r = H.byRateOf(inv([{ qty: 1, price: 100, rate: 10 }, { qty: 1, price: 50, rate: 0, supply_kind: 'gst_free' }, { qty: 1, price: 30, rate: 0, supply_kind: 'input_taxed' }])).rows;
  const byKind = Object.fromEntries(r.map((x) => [x.kind || 'none@' + x.rate, x.taxable]));
  assert.deepStrictEqual(byKind, { 'none@10': 100, gst_free: 50, input_taxed: 30 });
});
it('an invoice that names no kind groups by rate exactly as before (no kind key)', () => {
  const r = H.byRateOf(inv([{ qty: 1, price: 100, rate: 10 }, { qty: 2, price: 5, rate: 10 }])).rows;
  assert.deepStrictEqual(r.map((x) => [x.rate, x.taxable, 'kind' in x]), [[10, 110, false]]);
});
console.log(pass + ' checks');
