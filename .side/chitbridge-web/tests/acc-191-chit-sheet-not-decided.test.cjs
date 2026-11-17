/**
 * tests/acc-191-chit-sheet-not-decided.test.cjs — ACC-191: the chit sheet says "GST not decided" for an undecided tax (money.tax null), never a grid of dashes or 0.00.
 * OWNS      the proof that CBSheet.moneyBlockHTML prints the not-decided sentence when supply is unknown and tax is null, keeps the total, and prints a decided bill as before.
 * CALLED BY package.json check script. No browser, no network: the real chit-sheet.js and helpers.js in node.
 * FLOW      money (engine moneyOf shape) -> CBSheet.moneyBlockHTML -> the GST rows and the total as printed
 * CARD      02-tasks-orders-and-workflow/chit-as-lines
 * Run: node tests/acc-191-chit-sheet-not-decided.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const APP = (f) => path.join(__dirname, '..', 'public', 'app', f);
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(APP('helpers.js'), 'utf8'));
globalThis.document = { getElementById: () => null };
globalThis.counterOfBill = () => '';
globalThis.chitIsSelf = (en) => en === 'me';
eval(fs.readFileSync(APP('chit-sheet.js'), 'utf8'));
const S = globalThis.CBSheet;
let n = 0;
const ok = (cond, label) => { assert(cond, label); n++; console.log('  ok  ' + label); };
const undecided = { total: 45000, taxable: 45000, tax: null, cgst: null, sgst: null, igst: null, cess: null, vat: null, supply: 'unknown', by_rate: { 18: { taxable: 45000, cgst: null, sgst: null, igst: null, tax: null } } };
const html = S.moneyBlockHTML({ money: undecided, cur: 'INR', bj: {} });
ok(html.includes('data-testid="cs-gst-undecided"') && html.includes('GST not decided'), 'an undecided tax says "GST not decided"');
ok(!html.includes('cs-gst-18') && !/(^|[^0-9,.])0.00/.test(html.replace(/<[^>]+>/g, ' ')), 'no rate grid and no 0.00 beside it');
ok(html.includes('45,000') || html.includes('45000'), 'the total stays the price');
const decided = { total: 1180, taxable: 1000, tax: 180, cgst: 90, sgst: 90, igst: 0, supply: 'intra', by_rate: { 18: { taxable: 1000, cgst: 90, sgst: 90, igst: 0, tax: 180 } } };
const normal = S.moneyBlockHTML({ money: decided, cur: 'INR', bj: {} });
ok(normal.includes('data-testid="cs-gst-18"') && !normal.includes('cs-gst-undecided'), 'a decided bill prints its rate grid as before');
console.log('\n  ' + n + ' passed, 0 failed');
