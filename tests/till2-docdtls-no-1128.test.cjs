'use strict';
/* @type regression
   batch 1128 fixTill2 item 1b: the invoice stamped at send carries the bill number in DocDtls.No (bill_no, else printed_as), not null.
   invoiceFor puts its chit_id into DocDtls.No; lib/send-money.invoiceOfLines now hands it the bill's own number. No database.
   Run: node tests/till2-docdtls-no-1128.test.cjs */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://nobody@127.0.0.1:1/none';
const assert = require('assert');
const tl = require('../lib/tax-lines');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const ae = tl.partyOf({ country: 'AE', gstn: '100345678900003', display_name: 'Shop', registration: 'regular' });
const lines = [{ name: 'Cable', quantity: 1, price: 100, gst_rate: 5 }];
ok(tl.invoiceFor({ lines, seller: ae, buyer: {}, currency: 'AED', priceIncludesTax: true, chit_id: 'AE-0007' }).invoice.DocDtls.No === 'AE-0007', 'a number handed to invoiceFor lands in DocDtls.No');
ok(tl.invoiceFor({ lines, seller: ae, buyer: {}, currency: 'AED', priceIncludesTax: true }).invoice.DocDtls.No === null, 'with none it is null (the bug this fixes at send)');
const send = require('fs').readFileSync(__dirname + '/../lib/send-money.js', 'utf8');
ok(send.includes('chit_id: (business_json && (business_json.bill_no || business_json.printed_as)) ||'), 'invoiceOfLines hands invoiceFor the bill number (bill_no, else printed_as, read inline; 1129 fold)');
console.log(n + ' passed');
