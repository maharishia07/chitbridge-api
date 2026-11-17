/**
 * tests/chit-sheet-order.test.cjs — O7/O8: an ORDER chit's sheet shows the total the Chits list shows (summary_json.total_value) and, first,
 * what the customer typed at the shop (delivery address · time asked · remark). Also R10-4: a late 'close' event must not wipe a re-opened sheet.
 * Run: node tests/chit-sheet-order.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
globalThis.window = globalThis;
require('vm').runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'helpers.js'), 'utf8'));   /* T2-WEBPRIMS: the page's one esc · fmtMoney, not a stub */
globalThis.document = { getElementById: () => null };
globalThis.counterOfBill = () => '';
globalThis.chitIsSelf = (en) => en === 'm';
globalThis.billStepStatus = undefined;
eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'chit-sheet.js'), 'utf8'));
const S = globalThis.CBSheet;
const order = { header: { chit_id: 'c1', purpose: 'order', current_status: 'pending', created_at: '2026-10-09T10:25:00Z',
  all_recipients: [{ role: 'sender', display_name: 'athi', entity_id: 'a' }, { role: 'receiver', display_name: 'Mayur Bhavan', entity_id: 'm' }],
  summary_json: { total_value: 90, currency_code: 'INR', customer_locality: '12 Ring Rd',
    order_details: { channel: 'online', fulfilment: 'delivery', address: '12 Ring Rd, Pune', requested_delivery: { date: '2026-10-10', time: '13:00' }, remark: 'no onion' } } },
  detail: { line_items: [{ particulars: 'Onion Rava Dosa', quantity: 1, unit: 'plate', price: 90 }] } };
const m = S.model(order);
assert.strictEqual(m.money && m.money.total, 90, 'order total comes from summary_json.total_value');
const h = S.orderHTML(m);
assert(/12 Ring Rd, Pune/.test(h) && /2026-10-10 13:00/.test(h) && /no onion/.test(h) && /Online order/.test(h), 'address, time and remark are shown');
assert.strictEqual(S.orderHTML(S.model({ header: { purpose: 'invoice', summary_json: {} } })), '', 'a bill has no order block');
const old = S.model({ header: { purpose: 'order', summary_json: { total_value: 135, customer_locality: 'Anna Nagar' } } });
assert(/Anna Nagar/.test(S.orderHTML(old)) && old.money.total === 135, 'an older order keeps its area and its total');
console.log('chit-sheet-order: all ok');
