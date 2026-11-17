/**
 * acc-191-undecided-tax-null.test.cjs — ACC-191: an UNDECIDED tax is "not decided" (null), never 0 (bill, sendMoney header, till).
 * Case: a regular IN seller with NO STATE on record, 1 line 5 x 9000 at gst_rate 18 (supply 'unknown').
 * The one reader is the engine's moneyOf (lib/tax.js, adopted); the header copies it (routes/chits moneyOfInvoice). No database.
 * Run: node tests/acc-191-undecided-tax-null.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const TL = require(path.join(API, 'lib', 'tax-lines'));
const T = require(path.join(API, 'lib', 'tax'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const seller = { Gstin: null, LglNm: 'S', State: null, Country: 'IN', RegType: 'regular' };
const inv = TL.invoiceFor({ lines: [{ name: 'x', qty: 5, unit_price: 9000, gst_rate: 18, cess_rate: 12 }], seller, buyer: { Country: 'IN' }, currency: 'INR', at: '2026-11-07T00:00:00Z' }).invoice;
const m = T.moneyOf(inv, 'INR');
ok('supply is unknown', m.supply === 'unknown', m.supply);
ok('bill: money.tax is null, not 0', m.tax === null, 'tax=' + m.tax);
ok('bill: cgst/sgst/igst are null, not 0', m.cgst === null && m.sgst === null && m.igst === null, [m.cgst, m.sgst, m.igst].join());
ok('cess clause: an undecided supply carries no cess (CesVal 0)', inv.ValDtls.CesVal === 0, 'CesVal=' + inv.ValDtls.CesVal);
ok('the total stays the price (nothing taken out of it)', m.total === 45000, 'total=' + m.total);
let header; try { header = require(path.join(API, 'routes', 'chits')).moneyOfInvoice(inv, 'INR'); } catch (e) { header = { err: e.message }; }
ok('sendMoney header: summary_json.money.tax is null, not 0', header && header.tax === null, JSON.stringify(header && (header.err || header.tax)));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
