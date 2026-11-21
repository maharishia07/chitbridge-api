'use strict';
/**
 * CARD  01-rail-core-the-chit/line-model · 02-tasks-orders-and-workflow/everyones-work
 * tests/rail-mirror-sent-order.test.cjs — B-F-15 (walk B, 21 Nov): the BUYER's sheet of an order it sent, offline (the database stood in for; the real lib/work-rows,
 * lib/workflow, lib/rail-actions and lib/deliverline run). Two entities: R the buyer (holds the SENT copy, status pending), D the seller (accepted it, claims 8 and 9 against 4).
 *   · the buyer's row reads the seller's status (Accepted), through chit_participants, while its own copy still says pending (no second status is stored)
 *   · the line carries the seller's claim (theirs) and how far it runs past the order (over_theirs), beside the buyer's own delivered, never merged into it
 *   · the buyer's steps: Cancel is on before anything is delivered (via the sender's void door, asks for a reason); off once goods are claimed; Accept and Reject stay the seller's
 *   · the seller's own sheet is unchanged (its received copy moves through the steps; no hydration of a seen status)
 * Run: node tests/rail-mirror-sent-order.test.cjs
 */
const assert = require('assert');
const R = 'aaaaaaaa-0000-4000-8000-000000000001', D = 'bbbbbbbb-0000-4000-8000-000000000002', CHIT = 'cccccccc-0000-4000-8000-000000000003';
const db = require('../db');
const schema = require('../lib/schema');
schema.hasTable = async () => true;
let deliveries = [], participants = [];
db.withEntity = async (e, fn) => fn({ query: async () => ({ rows: participants }) });
let batch = async () => [];
db.readBatch = (...a) => batch(...a);
const deliverline = require('../lib/deliverline');
const select = require('../lib/select');
const LINE = deliverline.lineIdOf(CHIT, {}, 1);
const header = { chit_id: CHIT, line_items: [{ particulars: 'Widget', quantity: 4, unit: 'kg', price: 60.5 }], business_json: { order_no: 'WB-ORD-1' }, all_recipients: [] };
const progRow = (d) => ({ chit_id: CHIT, line_id: LINE, particulars: 'Widget', ordered_unit: 'kg', ordered: 4, ordered_price: 60.5, removed: false, delivery_id: d && d.id, dq: d && d.q, du: 'kg', recorded_by_entity_id: d && d.by, recorded_by_name: 'x', delivered_at: '2026-11-21' });
function stand(entity, direction, status) {
  select.rows = async () => [{ chit_id: CHIT, direction, current_status: status, purpose: 'order', sender_entity_id: R, biz_side: null, created_at: new Date().toISOString(), counterparty_name: 'Dist', manual_subject: 'WB-ORD-1', summary_json: {}, doc_kind: null }];
  batch = async (_e, _a, stmts) => stmts.map((s, i) => (i === 0 ? { rows: [header] } : /chit_participants/.test(s.text) ? { rows: participants } : /chit_line_assignment/.test(s.text) ? { rows: [] } : /FROM chit_line l/.test(s.text) ? { rows: (deliveries.length ? deliveries : [null]).map(progRow) } : { rows: [] }));
}
const work = require('../lib/work-rows');
const ctx = (entity) => ({ entity, actor: entity, me: { level: 'editor', holder: null }, now: Date.now() });
let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };

(async () => {
  participants = [{ chit_id: CHIT, current_status: 'accepted' }];
  deliveries = [{ id: 'd1', q: 8, by: D }, { id: 'd2', q: 9, by: D }];
  stand(R, 'sent', 'pending');
  const sheet = await work.one(ctx(R), CHIT);
  await it('the buyer reads Accepted (the seller\'s status), its own copy untouched', () => {
    assert.strictEqual(sheet.seen_status, 'accepted'); assert.strictEqual(sheet.status, 'pending'); assert.strictEqual(sheet.stage, 'accepted'); assert.notStrictEqual(sheet.word, 'Sent');
  });
  await it('the line carries the seller\'s claim 17 (8 + 9) and 13 over the 4 ordered; the buyer\'s own delivered stays 0', () => {
    const l = sheet.lines[0]; assert.strictEqual(l.theirs, 17); assert.strictEqual(l.over_theirs, 13); assert.strictEqual(l.delivered, 0);
  });
  await it('with the seller\'s goods claimed, Cancel is off with its sentence; Accept, Reject stay off', () => {
    assert.strictEqual(sheet.actions.cancel.ok, false); assert.match(sheet.actions.cancel.say, /already/); assert.strictEqual(sheet.actions.accept.ok, false); assert.strictEqual(sheet.actions.reject.ok, false);
  });
  deliveries = []; participants = [{ chit_id: CHIT, current_status: 'accepted' }];
  const clean = await work.one(ctx(R), CHIT);
  await it('before anything is delivered the buyer may Cancel, through the void door, asked for a reason', () => {
    assert.strictEqual(clean.actions.cancel.ok, true); assert.strictEqual(clean.actions.cancel.via, 'void'); assert.deepStrictEqual(clean.actions.cancel.needs, ['reason']);
    assert.strictEqual(clean.actions.accept.ok, false); assert.strictEqual(clean.lines[0].theirs, 0);
  });
  participants = [{ chit_id: CHIT, current_status: 'rejected' }];
  stand(R, 'sent', 'cancelled');
  const gone = await work.one(ctx(R), CHIT);
  await it('a sent copy already cancelled cannot be cancelled again', () => { assert.strictEqual(gone.actions.cancel.ok, false); });
  participants = []; stand(D, 'received', 'accepted');
  const seller = await work.one(ctx(D), CHIT);
  await it('the seller\'s sheet is as before: its own received copy, no seen status, Cancel by the status steps', () => {
    assert.strictEqual(seller.seen_status, null); assert.strictEqual(seller.status, 'accepted'); assert.strictEqual(seller.actions.cancel.ok, true); assert.strictEqual(seller.actions.cancel.via, undefined);
  });
  console.log(pass + ' passed'); 
  process.exit(process.exitCode || 0);
})();
