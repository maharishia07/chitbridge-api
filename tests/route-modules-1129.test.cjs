#!/usr/bin/env node
// @type: unit
/**
 * tests/route-modules-1129.test.cjs — the small modules moved out of routes/till.js, routes/books.js, routes/products.js and routes/chits.js (readability, batch 1129).
 *
 * OWNS      lib/till-credit-note-money (negOf · negRates · creditNoteMoney · isCounterTakings): the sign of a return, 0 never -0, a missing figure never 0, and a rail credit note is not a counter bill.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 *           lib/books-bs-shape (flat · sideOf · sched3 · bsTagged): the engine's lines regrouped, the profit line named, both sides added and the difference said.
 *           lib/products-media-guard (MEDIA_MIME_OK · mimeKey · MID_SHAPE · likeEscape · signedInAs) and lib/products-import-rows (importAnswer · zeroWithoutReason · dropRejected).
 * FLOW      hand-made rows -> the module -> the figure or the verdict
 * Run: node tests/route-modules-1129.test.cjs · MIN unit-per-rule · refusal-path · fail-closed (a figure that is not a number answers null, never 0; a row that is not a counter bill is refused from the day)
 * CARD      counter/till-routes
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { flat, sideOf, sched3, bsTagged } = require('../lib/books-bs-shape');
const media = require('../lib/products-media-guard');
const importRows = require('../lib/products-import-rows');
const { negOf, negRates, creditNoteMoney, isCounterTakings } = require('../lib/till-credit-note-money');

test('a return is a negative figure, 0 stays 0 (never -0) and a non-number is null (fail closed, never 0)', () => {
  assert.equal(negOf(11), -11);
  assert.equal(Object.is(negOf(0), 0), true);
  assert.equal(negOf('11'), null);
  assert.equal(negOf(NaN), null);
});

test('by_rate comes back as signs, base is read when taxable is absent, and none stored is null', () => {
  assert.deepEqual(negRates({ 5: { base: 10, tax: 0.5 } }), { 5: { taxable: -10, tax: -0.5 } });
  assert.equal(negRates(null), null);
  assert.equal(negRates({}), null);
});

test('only a credit-note slip gets the money object; a sale row stays {}', () => {
  assert.deepEqual(creditNoteMoney({ slip: 'cash' }), {});
  const note = creditNoteMoney({ slip: 'credit_note', taxable: 10, tax: 1, refund: { total: 11, parts: [] } });
  assert.equal(note.total, -11);
  assert.equal(note.by_rate, null);
  assert.equal(note.against, null);
});

test('a rail credit note with no counter object and no slip is refused from the counters takings (refusal)', () => {
  assert.equal(isCounterTakings({ purpose: 'credit_note', business_json: {} }), false);
  assert.equal(isCounterTakings({ purpose: 'credit_note', business_json: { slip: 'credit_note' } }), true);
  assert.equal(isCounterTakings({ purpose: 'order', business_json: {} }), true);
  assert.equal(isCounterTakings(null), true);
});

const lines = [{ line: 'cash', label: 'Cash', amount_minor: 500, accounts: [{ code: '1000', name: 'Till', amount_minor: 500, role: 'cash' }] }];

test('flat lists each ledger under its head, and sideOf orders heads by the pack and names the profit line', () => {
  assert.deepEqual(flat(lines), [{ code: '1000', name: 'Till', amount_minor: 500, line: 'Cash', role: 'cash' }]);
  const side = sideOf([{ line: 'b', label: 'B', amount_minor: -5, accounts: [{ amount_minor: -5, role: 'profit_to_date' }] }, lines[0]], ['cash', 'b'], 'INR');
  assert.deepEqual(side.heads.map((head) => head.line), ['cash', 'b']);
  assert.equal(side.heads[1].ledgers[0].name, 'Net loss');
  assert.equal(side.total_minor, 495);
});

test('sched3 says it does not balance (fail closed) and by how much; bsTagged leaves a side with no earlier day at null', () => {
  const sheet = sched3({ assets: lines, liabilities: [] }, ['cash'], 'INR');
  assert.equal(sheet.balanced, false);
  assert.equal(sheet.difference_minor, 500);
  const tagged = bsTagged([{ code: '1000', amount_minor: 500 }], {}, () => null, 'INR');
  assert.equal(tagged[0].prior_month_minor, null);
  assert.equal(tagged[0].group, null);
});

test('only an allowed file type is named, a media id must be a UUID, and LIKE characters are made plain (refusal)', () => {
  assert.equal(media.MEDIA_MIME_OK.has(media.mimeKey('Image/PNG; charset=x')), true);
  assert.equal(media.MEDIA_MIME_OK.has(media.mimeKey('text/html')), false);
  assert.equal(media.MID_SHAPE.test('12345678-1234-1234-1234-123456789abc'), true);
  assert.equal(media.MID_SHAPE.test('%'), false);
  assert.equal(media.likeEscape('a_b%c!'), 'a!_b!%c!!');
});

test('a bad or missing token is never signed in as the shop (fail closed)', () => {
  assert.equal(media.signedInAs({ headers: {} }, 'shop'), false);
  assert.equal(media.signedInAs({ headers: { authorization: 'Bearer not-a-token' } }, 'shop'), false);
});

test('the import answer counts and says the rows left out; dropRejected keeps items and lines in step; a 0% item with no reason is named', () => {
  const answer = importRows.importAnswer([{ action: 'created' }, { action: 'failed' }], [], [{ line: 3 }]);
  assert.deepEqual(answer.summary, { created: 1, updated: 0, failed: 1, rejected: 1 });
  assert.ok(answer.message.startsWith('1 added, 0 updated, 1 failed, 1 row(s) not imported'));
  const kept = importRows.dropRejected({ items: ['a', 'b'], lines: [2, 3] }, [{ line: 3 }]);
  assert.deepEqual(kept, { items: ['a'], lines: [2] });
  assert.equal(importRows.zeroWithoutReason({ gst_rate: 0 }), true);
  assert.equal(importRows.zeroWithoutReason({ gst_rate: 0, nil_kind: 'exempt' }), false);
});

const sendBill = require('../lib/chits-send-bill');
const stubAnswer = () => ({ locals: {}, headers: {}, status() { return this; }, set() { return this; }, type() { return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } });

test('a shop that may not charge tax is refused when its invoice carries tax; a regular or unknown seller is not (refusal, fail closed)', () => {
  const taxed = { invoice: { ValDtls: { CgstVal: 5, SgstVal: 5 } } };
  assert.equal(sendBill.taxNotChargeableRefusal({ seller: { RegType: 'composition' } }, taxed).code, 'TAX_NOT_CHARGEABLE');
  assert.equal(sendBill.taxNotChargeableRefusal({ seller: { RegType: 'regular' } }, taxed), null);
  assert.equal(sendBill.taxNotChargeableRefusal(null, taxed), null);
});

test('the bill-number step lets a draft and a non-counter chit through (the refusal itself runs over express in walkf-1128-core)', async () => {
  const step = sendBill.billNumberStep(async () => 'IN');
  assert.equal(await step({ sender_id: 's', is_draft: true }, { body: { business_json: { till: {}, bill_no: '' } } }, stubAnswer()), undefined);
  assert.equal(await step({ sender_id: 's', is_draft: false }, { body: { business_json: { bill_no: '' } } }, stubAnswer()), undefined);
});

test('the tender step does nothing for a draft or a bill with no payment; the named-customer add refuses an unnamed or rail customer without a database', async () => {
  assert.equal(await sendBill.sendTenderSum({ is_draft: true, business_json: { payment: {} } }, {}, stubAnswer()), undefined);
  assert.equal(await sendBill.sendTenderSum({ is_draft: false, business_json: {} }, {}, stubAnswer()), undefined);
  assert.equal(await sendBill.addNamedCounterCustomer('shop', { customer: { name: 'Customer' } }), null);
  assert.equal(await sendBill.addNamedCounterCustomer('shop', { customer: { name: 'Acme', entity_id: 'e1' } }), null);
  assert.equal(await sendBill.addNamedCounterCustomer('shop', null), null);
});

test('the cancel flag stamps each OTHER recipient once, pushes the cross-installation answer, and never throws (lib/chits-cancel-flag)', async () => {
  const path = require('node:path');
  const stub = (rel, exportsOf) => { const id = require.resolve(rel); require.cache[id] = { id, filename: id, loaded: true, exports: exportsOf }; };
  const stamped = [];
  let hasColumn = true;
  stub('../db', { withEntity: async (_entity, fn) => fn({ query: async () => ({ rows: [{ all_recipients: [{ entity_id: 'a' }, { entity_id: 'a' }, { entity_id: 'me' }, { entity_id: 'b' }, null] }] }) }) });
  stub('../lib/schema', { hasColumn: async () => hasColumn });
  stub('../lib/chit-move', { stampCancelRequested: async (rid) => { stamped.push(rid); } });
  stub('../lib/ctpreturn', { onCancelRequested: async () => 'told-answer' });
  const { flagCancelRequested } = require('../lib/chits-cancel-flag');
  const req = { identity: { display_name: 'Asha' } };
  const told = [];
  await flagCancelRequested(req, 'me', 'c1', 'wrong order', told);
  assert.deepEqual(stamped, ['a', 'b'], 'a duplicate recipient and the sender are not stamped');
  assert.deepEqual(told, ['told-answer']);
  stamped.length = 0;
  hasColumn = false;
  await flagCancelRequested(req, 'me', 'c1', 'x', told);
  assert.deepEqual(stamped, [], 'before the migration nothing is stamped');
  assert.equal(path.basename(require.resolve('../lib/chits-cancel-flag')), 'chits-cancel-flag.js');
});
