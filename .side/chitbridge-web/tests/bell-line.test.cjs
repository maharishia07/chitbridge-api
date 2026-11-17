/**
 * tests/bell-line.test.cjs — O3: a NEW incoming order's bell row says "sent a new order", shows the amount and is in LOCAL time (never "delivered", never UTC text).
 * CARD      22-channels-capture-and-messaging/notifications-and-the-bell
 * Run: node tests/bell-line.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
process.env.TZ = 'Asia/Kolkata';
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, documentElement: { appendChild() {} }, addEventListener() {} };
require('vm').runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'helpers.js'), 'utf8'));   /* T2-WEBPRIMS: the page's one esc · fmtMoney */
for (const part of ['rail-bell-html.js', 'rail-bell-rows.js', 'rail-bell.js']) eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', part), 'utf8'));
const L = globalThis.CBBell.line;
const o = L({ action: 'delivered', purpose: 'order', direction: 'received', action_by_display_name: 'athi', auto_subject: 'Order from athi — 09 Oct 2026',
  created_at: '2026-10-09T10:25:00.000Z', chit_id: 'c1', total_value: '90', currency_code: 'INR', order_channel: 'online', order_fulfilment: 'delivery' });
assert.strictEqual(o.say, 'sent a new order'); assert(!/deliver(ed)?\b/i.test(o.say), 'must not say delivered');
assert(/90/.test(o.d) && /Online/.test(o.d) && /Delivery/.test(o.d), 'amount and how: ' + o.d);
assert(/3:55|03:55/.test(o.s) && !/10:25/.test(o.s), 'local time (IST 15:55), got ' + o.s);
const r = L({ action: 'delivered', purpose: 'invoice', direction: 'received', action_by_display_name: 'x', auto_subject: 'Bill', created_at: '2026-10-09T10:25:00Z', chit_id: 'c2' });
assert.strictEqual(r.say, 'delivered', 'other rows keep their words');
/* F2 (17 Nov): a note on a CLIENT is titled with the client's name - the line names the client ONCE */
const n = L({ action: 'note_reply', action_by_display_name: 'Acc', mark_client: 'Client One', mark_entry: { entry_id: 'cid', entry_no: null, label: 'Client One' }, created_at: '2026-10-09T10:25:00Z' });
assert.strictEqual(n.subj, 'Client One', 'client named once, got: ' + n.subj);
assert.strictEqual(n.note, 'cid');
const m = L({ action: 'note_reply', action_by_display_name: 'Acc', mark_client: 'Client One', mark_entry: { entry_id: 'e1', entry_no: null, label: 'SV/1 · memo' }, created_at: '2026-10-09T10:25:00Z' });
assert.strictEqual(m.subj, 'Client One · SV/1 · memo', 'an entry note still names its client first');
/* F1: a Query notice carries its client (a firm's) or none (the owner's): the shared bell code routes on it */
const q = L({ action: 'mark_query', mark_client: 'Client One', mark_client_id: 'cid', mark_entry: { entry_id: 'e1', entry_no: 'PY/1', posting_date: '2026-07-27' }, created_at: '2026-10-09T10:25:00Z' });
assert.strictEqual(q.mark.client, 'Client One'); assert.strictEqual(q.mark.clientId, 'cid'); assert.strictEqual(q.mark.id, 'e1');
assert.strictEqual(L({ action: 'mark_query', mark_entry: { entry_id: 'e1', entry_no: 'PY/1' }, created_at: '2026-10-09T10:25:00Z' }).mark.client, '');
console.log('bell-line: all ok');
