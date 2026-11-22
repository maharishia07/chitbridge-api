'use strict';
/* WALK I I-F-03 (21 Nov 2026): a counter sale to a buyer WITH a TRN keeps the buyer on the AE invoice: name + TRN, a B2B supply, and NO state invented from the
   TRN's first digits (the "10" of a GSTIN habit; an ABN or TRN is not a state-split number: lib/tax-copy.counterBuyerOf, the one builder the live copy and the
   invoice stamped at send share). Seller AE, AED 100.00 inclusive -> VAT 476 fils, taxable 9524 fils. Under IN the state is still read off the GSTIN.
   Run: node tests/walki-ae-buyer-trn.test.cjs */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nobody@127.0.0.1:1/none';
const assert = require('assert');
const tc = require('../lib/tax-copy'), tl = require('../lib/tax-lines');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const ae = tl.partyOf({ country: 'AE', gstn: '100345678900003', display_name: 'Shop', registration: 'regular' });
const b = tc.counterBuyerOf({ name: 'Acme Trading LLC', gstin: '100123456700003' }, ae);
ok(b.Gstin === '100123456700003' && b.LglNm === 'Acme Trading LLC' && b.RegType === 'regular', 'AE buyer keeps name and TRN');
ok(b.State === null, 'AE buyer: no state invented from the TRN (was "10")');
const inv = tl.invoiceFor({ lines: [{ name: 'Cable Roll', quantity: 1, price: 100, gst_rate: 5 }], seller: ae, buyer: b, currency: 'AED', priceIncludesTax: true, chit_id: 'c1' }).invoice;
ok(inv.TranDtls.SupTyp === 'B2B' && inv.BuyerDtls.Gstin === '100123456700003', 'invoice: SupTyp B2B, BuyerDtls carries the TRN (was B2C, TRN dropped)');
ok(Math.round(inv.ValDtls.TaxVal * 100) === 476 && Math.round(inv.ValDtls.AssVal * 100) === 9524, 'VAT 476 fils, taxable 9524 fils');
const inShop = tl.partyOf({ country: 'IN', gstn: '33AAAAA0000A1Z5', display_name: 'S', registration: 'regular' });
ok(tc.counterBuyerOf({ name: 'B', gstin: '29AABCU9603R1ZM' }, inShop).State === '29', 'IN seller: the state is still the GSTIN\'s first two digits');
ok(tc.counterBuyerOf({ name: 'W' }, ae).RegType === 'unregistered', 'no number: unregistered walk-in');
const send = require('fs').readFileSync(__dirname + '/../lib/send-money.js', 'utf8');
ok(/taxCopy\.counterBuyerOf\(cust, taxLines\.partyOf\(seller\)\)/.test(send), 'the invoice stamped at send builds the buyer from business_json.customer');
console.log(n + ' passed');
