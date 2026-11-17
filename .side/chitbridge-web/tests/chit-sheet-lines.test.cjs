/**
 * tests/chit-sheet-lines.test.cjs — QA no-proof wave 1 (6 Nov 2026): the chit as LINES, read by the design-2 sheet (public/app/chit-sheet.js, CBSheet).
 *
 * OWNS      the proof that the sheet's model (a) takes the chit's lines from the LIVE SET when the read carries one (b142: a removed line is dropped, an edited line
 *           shows its live text, the order of the set is kept) and from detail.line_items otherwise, (b) says "no lines" when there are none,
 *           (c) shows the figures the chit was FROZEN with - the total and the rate-wise GST are read from summary_json.money, never summed from the lines
 *           (the lines below add up to 1,100 and the frozen total says 1,129.80: the sheet shows 1,129.80), and (d) says "not recorded" for a money figure the chit does not hold
 *           instead of showing 0.
 * CALLED BY package.json check script · .github/workflows/ci.yml (web job). No browser, no network: the real chit-sheet.js and helpers.js in node.
 * FLOW      chit read ({ header, detail, live_set }) -> CBSheet.model -> lines · money -> CBSheet.moneyBlockHTML -> the GST rows and the total as printed
 * CARD      02-tasks-orders-and-workflow/chit-as-lines
 * UNIT      02/Chit as lines (design 2 sheet)
 * MUTATION  checked once: in chit-sheet.js model(), drop the `!e.removed &&` test of the live set -> "a removed line is not shown" goes red.
 * Run: node tests/chit-sheet-lines.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const APP = (f) => path.join(__dirname, '..', 'public', 'app', f);
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(APP('helpers.js'), 'utf8')); /* the page's one esc - fmtMoney, not a stub */
globalThis.document = { getElementById: () => null };
globalThis.counterOfBill = () => '';
globalThis.chitIsSelf = (en) => en === 'me';
eval(fs.readFileSync(APP('chit-sheet.js'), 'utf8'));
const S = globalThis.CBSheet;
const text = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

let n = 0;
const ok = (cond, label) => { assert(cond, label); n++; console.log('  ok  ' + label); };

const header = {
  chit_id: 'c9', purpose: 'order', current_status: 'pending', created_at: '2026-10-09T10:25:00Z',
  all_recipients: [{ role: 'sender', display_name: 'Meena', entity_id: 'x' }, { role: 'receiver', display_name: 'Shop', entity_id: 'me' }],
  summary_json: {
    currency_code: 'INR',
    money: { total: 1129.8, taxable: 1076, tax: 53.8, cgst: 26.9, sgst: 26.9, supply: 'intra', by_rate: { 5: { taxable: 1076, cgst: 26.9, sgst: 26.9, tax: 53.8 } }, lines: [{ total: 525, tax: 25, discount: 0 }, { total: 604.8, tax: 28.8, discount: 64 }] }
  }
};
const detail = { line_items: [{ particulars: 'Tea', quantity: 2, unit: 'kg', price: 250 }, { particulars: 'Sugar', quantity: 1, price: 600 }] };

/* (a) which lines */
const plain = S.model({ header, detail });
ok(plain.hasLines && plain.lines.map((x) => x.particulars).join() === 'Tea,Sugar', 'with no live set the lines are detail.line_items, in order');
const live = S.model({
  header, detail,
  live_set: [{ live: { particulars: 'Tea (large)', quantity: 3, price: 250 } }, { removed: true, live: { particulars: 'Sugar', quantity: 1, price: 600 } }, { live: { particulars: 'Jaggery', quantity: 1, price: 90 } }]
});
ok(live.lines.map((x) => x.particulars).join() === 'Tea (large),Jaggery', 'with a live set the lines are its live text, in its order');
ok(!live.lines.some((x) => x.particulars === 'Sugar'), 'a removed line is not shown');
const none = S.model({ header: { purpose: 'order', summary_json: {} }, detail: { line_items: [] } });
ok(none.hasLines === false && none.lines.length === 0, 'a chit with no lines says it has none');

/* (c) the frozen figures are read, never summed */
const sumOfLines = detail.line_items.reduce((s, x) => s + x.quantity * x.price, 0);
ok(sumOfLines === 1100 && plain.money.total === 1129.8, 'the lines add up to 1,100 and the frozen total (1,129.80) is the one the sheet holds');
const block = text(S.moneyBlockHTML(plain, 't'));
ok(/Total\|₹1,129\.80/.test(block), 'the total as printed is the frozen 1,129.80, not the sum of the lines');
ok(/5%\|₹1,076\.00\|₹26\.90\|₹26\.90/.test(block), 'the GST is the frozen rate-wise row: 5% on 1,076.00 with CGST 26.90 and SGST 26.90');
ok(plain.money.lines.length === 2 && plain.money.lines[1].discount === 64, 'the frozen per-line figures (total, tax, offer taken off) travel with the model');

/* (d) a figure the chit does not hold is said so */
ok(none.money === null, 'a chit with no frozen money has no money block');
const bare = text(S.moneyBlockHTML(none, 't'));
ok(/Rate-wise GST is not recorded on this bill/.test(bare) && /Total\|not recorded/.test(bare), 'no frozen money: "not recorded" for the GST and the total, never 0');
ok(!/₹0\.00/.test(bare), 'no frozen money: no invented 0.00');

console.log('chit-sheet-lines: all ok (' + n + ' checks)');
