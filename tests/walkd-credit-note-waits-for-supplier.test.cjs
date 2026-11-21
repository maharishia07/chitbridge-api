/**
 * tests/walkd-credit-note-waits-for-supplier.test.cjs — WALK-D D-F-11: A RECEIVED CREDIT NOTE WAITS FOR THE SUPPLIER LIST LIKE THE BILL IT REDUCES.
 *
 * OWNS      lib/books-hooks classify: the buyer's verdict for a supplier credit note (a purchase_return) carries supplier_check: true, the flag postChit reads to park it with "<seller> is not on your supplier list - add them,
 *           then this posts". The walker's buyer held Suppliers Dr 4.80 and Purchase returns Cr 4.36 / GST Cr 0.44 with NO bill behind it (the bills waited for the list; the note did not) while the seller's Customers held 165.00 - 4.80 = 160.20.
 *           Hand figure: A$4.80 tax-in at 10% → GST 4.80 / 11 = 0.44 (44 minor), return 4.36 (436 minor). The seller's own side (a sale return) is not gated by the supplier list.
 *           ⚠️ The post/park behaviour itself (supplierCheck) is the existing path for the bill; the real-stack proof is the walk's p7.cjs on a box (cbt-wkd-au-a/b: both TBs, A with B added and not).
 * CALLED BY by hand: node tests/walkd-credit-note-waits-for-supplier.test.cjs
 * FLOW      credit_note chit → classify(entry.sells false) → { kind post, supplier_check: true, event purchase_return } → postChit → supplierCheck → park | post
 * CARD      14-accounting/README
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const hooks = require(path.join(HERE, 'lib', 'books-hooks'));
const services = require(path.join(HERE, 'lib', 'services'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const invoice = services.computeTax({ seller: { Country: 'AU', Gstin: '12345678901', RegType: 'regular', Name: 'S' }, buyer: { Country: 'AU', Name: 'B' }, lines: [{ id: 'a', name: 'Quote adjustment', qty: 12, unit_price: 0.4, discount: 0, gst_rate: 10, cess_rate: 0 }], priceIncludesTax: true });
const chit = { chit_id: 'c0000000-0000-4000-8000-0000000000d1', created_at: '2026-11-21T05:00:00Z', purpose: 'credit_note', currency_code: 'AUD', business_json: { invoice, against: { chit_id: 'c0000000-0000-4000-8000-000000000001' } } };
const setting = { enabled: true, country: 'AU', functional_currency: 'AUD' };

console.log('\n== WALK-D D-F-11 · a supplier credit note waits for the supplier list ==\n');
ok('the note totals A$4.80 with GST 0.44 (hand: 4.80 / 11)', invoice.ItemList[0].TotItemVal === 4.8 && invoice.ItemList[0].TaxAmt === 0.44, JSON.stringify(invoice.ItemList[0]));
const buyer = hooks.classify({ chit, entry: { sells: false, seller: { entity_id: 's1' }, buyer: { entity_id: 'b1' }, invoice }, setting });
ok('the buyer\'s verdict is a purchase_return that carries supplier_check', buyer.kind === 'post' && buyer.event.type === 'purchase_return' && buyer.supplier_check === true, JSON.stringify(buyer).slice(0, 300));
ok('…for the supplier named on the note (party s1), the flag postChit reads', buyer.event.party === 's1');
const seller = hooks.classify({ chit, entry: { sells: true, seller: { entity_id: 's1' }, buyer: { entity_id: 'b1' }, invoice }, setting });
ok('the seller\'s side is never gated by a supplier list', seller.supplier_check === undefined);
console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
