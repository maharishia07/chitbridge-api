/**
 * tests/walkn-counts-1129.test.cjs — WALK N N-F-03 / N-F-04: the work counts only work that CAME to the shop; a DRAFT is not a chit on the rail and does not bill an order.
 * Offline. Hand figures (walk N, shop B): received orders PO-1..PO-4 with 3+2+1+1 = 7 pieces in 4 work lines; two sent orders; one unsent draft invoice INV-2.
 * Open chits on the rail = 4 received + 2 sent = 6 (the draft is the 7th the walk read).
 */
'use strict';
const assert = require('assert');
const measure = require('../lib/measure');
const openOrders = require('../lib/open-orders');

let fails = 0;
const t = (name, fn) => { try { fn(); console.log('   ok   ' + name); } catch (e) { fails++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
const copy = (id, direction, role) => ({ chit_id: id, direction, role, current_status: 'pending', purpose: 'order', created_at: new Date().toISOString() });
const rail = [copy('PO-1', 'received', 'Act'), copy('PO-2', 'received', 'Act'), copy('PO-3', 'received', 'Act'), copy('PO-4', 'received', 'Act'),
  copy('S-1', 'sent', 'Act'), copy('S-2', 'sent', 'Act'), copy('INV-2', 'sent', 'Draft')];

t('Reports counts 6 open chits, not 7: the unsent draft is not on the rail', () => assert.strictEqual(measure.measure(rail).open, 6));
t('a shop with only a draft has 0 open', () => assert.strictEqual(measure.measure([copy('D', 'sent', 'Draft')]).open, 0));
t('rows without a role (older readers) still count', () => assert.strictEqual(measure.measure([{ chit_id: 'x', current_status: 'pending' }]).open, 1));
t('the billed test reads only a SENT bill (role <> Draft), in the marks read and the one-chit read', () => {
  assert.ok(/COALESCE\(role, ''\) <> 'Draft'/.test(openOrders.MARKS_SQL));
  assert.ok(/COALESCE\(role, ''\) <> 'Draft'/.test(openOrders.billedOfChitSql('$1', '$2')));
});

/* N-F-06: a buyer's order never lists its seller as the buyer's customer; a bill the sender issues still lists the receiver (hand: A sends 4 POs to B -> A 0 customers; B sends 2 bills to A -> A is B's customer) */
const ra = require('../lib/rail-actions');
t('an order to a seller: the sender is the buyer, the receiver is no customer of it', () => assert.strictEqual(ra.receiverIsCustomer({ orderLike: true, sellerId: 'B', sender_id: 'A' }), false));
t('a bill the sender issues: the receiver is its customer', () => assert.strictEqual(ra.receiverIsCustomer({ orderLike: false, sellerId: 'B', sender_id: 'B' }), true));
t('an order whose seller is the sender (a sell-side order): the receiver is its customer', () => assert.strictEqual(ra.receiverIsCustomer({ orderLike: true, sellerId: 'B', sender_id: 'B' }), true));

/* N-F-03: the worklist's SQL (lib/assign byPerson) keeps work that came to me and never an invoice or a sent order */
let sql = '';
const dbPath = require.resolve('../db');
require.cache[dbPath] = { exports: { withEntity: async (id, fn) => fn({ query: async (text) => { sql = String(text); return { rows: [] }; } }), onEntity: async () => ({ rows: [] }), query: async () => ({ rows: [] }) } };
const assign = require('../lib/assign');
(async () => {
  await assign.byPerson('e1');
  const flat = sql.replace(/\s+/g, ' ');
  t('the worklist leaves out invoices', () => assert.ok(/COALESCE\(h\.purpose, ''\) <> 'invoice'/.test(flat)));
  t('the worklist keeps only what came to me (received), a firm job chit on its sent copy', () => assert.ok(/CASE WHEN COALESCE\(h\.is_job, false\) THEN h\.direction <> 'received' ELSE COALESCE\(h\.direction, 'received'\) = 'received' END/.test(flat)));
  t('the header lateral carries direction, purpose and the job mark', () => assert.ok(/role, direction, purpose, \(business_json \? 'job'\) AS is_job/.test(flat)));
  console.log('\n10 checks' + (fails ? ', ' + fails + ' FAILED' : ''));
  process.exit(fails ? 1 : 0);
})();
