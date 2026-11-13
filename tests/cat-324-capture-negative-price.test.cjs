'use strict';
// @type: contract
/**
 * tests/cat-324-capture-negative-price.test.cjs — CAT-324: a message line matched to a catalogue item with a NEGATIVE stored price never becomes a negative line total.
 *
 * OWNS      lib/capture.js raisePayload: the catalogue price is used only when lib/sellable-price.js says it can be sold; a negative behaves exactly as unset
 *           (the sender's own rate stands, nothing is counted from_catalogue); zero is a price and is kept.
 * Hand-computed: Rice 10 kg, catalogue -50, sender said nothing → price 0, total 0 · Sugar 2 kg, catalogue -40, sender said 30 → price 30, total 60 ·
 *           Salt 3 kg, catalogue 0 → price 0, from_catalogue · Oil 2 l, catalogue 90 → price 90, total 180. from_catalogue = 2 (Salt, Oil).
 * Break check: take sellablePrice.soldAt out of raisePayload and Rice totals -500 and Sugar -80 (the test fails).
 * CALLED BY scripts/guards.cjs · CI. No database, no network. CARD 07-offers-pricing-and-combos/till-price-and-worth-an-offer
 * Run: node tests/cat-324-capture-negative-price.test.cjs
 */
process.env.TZ = 'Asia/Kolkata';
const path = require('path');
const API = path.join(__dirname, '..');
const ENT = '11111111-1111-4111-8111-111111111111';
const CATALOGUE = [['Rice', -50], ['Sugar', -40], ['Salt', 0], ['Oil', 90]];
const CAPTURE = { id: 'c1', status: 'pending', channel: 'whatsapp', sender_ref: '+91', raw_text: 'rice 10 kg, sugar 2 kg at 30, salt 3 kg, oil 2 litre',
  structured: { subject: 's', line_items: [
    { particulars: 'Rice', qty: 10, unit: 'kg', raw_phrase: 'rice 10 kg' },
    { particulars: 'Sugar', qty: 2, unit: 'kg', rate: 30, raw_phrase: 'sugar 2 kg at 30' },
    { particulars: 'Salt', qty: 3, unit: 'kg', raw_phrase: 'salt 3 kg' },
    { particulars: 'Oil', qty: 2, unit: 'litre', raw_phrase: 'oil 2 litre' }] } };
const answer = (sql) => {
  if (/FROM capture/.test(sql)) return { rows: [CAPTURE] };
  if (/FROM catalogue_items/.test(sql)) return { rows: CATALOGUE.map(([name, price], i) => ({ item_id: 'i' + i, item_data: { name, price: { amount: price, currency: 'INR' }, unit: 'kg' }, updated_at: '2026-09-29T10:00:00.000Z' })) };
  return { rows: [] };
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, require(dbPath), {
  query: async (s) => answer(String(s)),
  withEntity: async (_e, fn) => fn({ query: async (s) => answer(String(s)) }),
  readBatch: async () => []
}) };
require(path.join(API, 'lib', 'logger')).warn = () => {};
const assert = require('assert');
(async () => {
  const out = await require(path.join(API, 'lib', 'capture')).raisePayload(ENT, 'c1', {});
  const by = {};
  for (const l of out.line_items) by[l.particulars] = l;
  assert.ok(by.Rice && by.Sugar && by.Salt && by.Oil, 'all four lines come back: ' + Object.keys(by));
  assert.strictEqual(by.Rice.price, 0, 'negative catalogue price, no rate said: unset, not -50'); assert.strictEqual(by.Rice.total, 0);
  assert.strictEqual(by.Sugar.price, 30, "negative catalogue price: the sender's own rate stands"); assert.strictEqual(by.Sugar.total, 60);
  assert.strictEqual(by.Salt.price, 0); assert.strictEqual(by.Salt.total, 0);
  assert.strictEqual(by.Oil.price, 90); assert.strictEqual(by.Oil.total, 180);
  for (const l of out.line_items) assert.ok(!(l.price < 0) && !(l.total < 0), l.particulars + ' is never negative');
  console.log('  ok   4 lines: negative catalogue price behaves as unset, zero and a good price unchanged');
  console.log('1 passed, 0 failed');
})().catch((e) => { console.log('  FAIL ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n')); console.log('0 passed, 1 failed'); process.exitCode = 1; });
