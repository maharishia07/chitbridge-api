/* CTR-166 — a bill of supply prints the buyer's registration number when the buyer has one (CGST Rules r.49(d): the recipient's GSTIN or UIN, if registered).
   The page's slipBuyerHTML is lifted out and run. CTR166_MUTATE=1 puts the tax-only guard back and must fail. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
let page = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
if (process.env.CTR166_MUTATE === '1') page = page.replace("return kind === 'tax' || kind === 'supply';", "return kind === 'tax';");
const grab = (name) => new RegExp('function ' + name + '\\([\\s\\S]*?\\n}\\n').exec(page)[0];
const src = ['slipBuyerHTML', 'slipBuyerKind', 'slipNoBuyerHTML'].map(grab).join('\n');
const ctx = { esc: String, invoiceRule: () => ({}), taxIdLabel: () => 'GSTIN', money: String, buyerFromMajor: () => 50000 };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const t = (a, b) => a + '|' + b;
assert.strictEqual(ctx.slipBuyerHTML({ kind: 'supply', total: 90, customer: { gstin: '29ABCDE1234F1Z5' } }, t), 'Buyer GSTIN|29ABCDE1234F1Z5', 'a bill of supply must name a registered buyer');
assert.strictEqual(ctx.slipBuyerHTML({ kind: 'supply', total: 90, customer: { name: 'Walk-in' }, not_invoice: 'buyer_identity' }, t), '', "no buyer number, and the no-buyer sentence stays a tax invoice's");
assert.strictEqual(ctx.slipBuyerHTML({ kind: 'tax', total: 90, customer: { gstin: '29ABCDE1234F1Z5' } }, t), 'Buyer GSTIN|29ABCDE1234F1Z5', 'tax invoice unchanged');
assert.strictEqual(ctx.slipBuyerHTML({ kind: 'cash', total: 90, customer: { gstin: '29ABCDE1234F1Z5' } }, t), '', 'a cash memo prints no buyer row');
console.log('till-s4-ctr166-supply-buyer ok · 4 checks');
