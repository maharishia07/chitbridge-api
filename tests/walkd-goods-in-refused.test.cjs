/**
 * tests/walkd-goods-in-refused.test.cjs — WALK-D D-F-01..05: A GOODS-IN THAT CANNOT MOVE STOCK IS REFUSED 400 IN WORDS, NEVER "SENT".
 *
 * OWNS      routes/chits.js sendReceiptLines + lib/receipt-lines.js over real express and the real problem renderer; a db stand-in answers the shop's catalogue (one plain product, one batch-kept product).
 *           Hand figures: qty 0 / -3 / 1e12 → BAD_QTY; no cost / cost -1 → BAD_PRICE; ghost item → RECEIPT_ITEM_UNKNOWN; batch-kept with no lot → RECEIPT_LOT_REQUIRED;
 *           lot expired 2025-01-01 (today 2026-11-21) → RECEIPT_LOT_EXPIRED; "12/03/25" → RECEIPT_DATE_UNREADABLE; "2026-13-45" → RECEIPT_DATE_UNREADABLE; a good receipt, a draft and an order → pass.
 *           lib/stock-store lotsOf: the FEFO read carries the expiry filter (expired lots never picked).
 * CALLED BY by hand: node tests/walkd-goods-in-refused.test.cjs
 * FLOW      POST body ──▶ express ──▶ sendReceiptLines(sendState from the body) ──▶ 400 problem | 200
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 */
'use strict';
const path = require('path'), http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const PLAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BATCHED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GHOST = '11111111-0000-4000-8000-000000000000';
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
const answer = async (sql, params) => {
  if (/SELECT item_id FROM catalogue_items/.test(sql)) return { rows: (params[1] || []).filter((id) => id === PLAIN || id === BATCHED).map((item_id) => ({ item_id })), rowCount: 0 };
  if (/batch_tracked/.test(sql)) return { rows: [{ item_id: BATCHED, batch_tracked: true, stocked: null }, { item_id: PLAIN, batch_tracked: null, stocked: null }], rowCount: 2 };
  return { rows: [], rowCount: 0 };
};
require.cache[dbFile].exports = Object.assign({}, real, { query: answer, withEntity: async (entity, fn) => fn({ query: answer }) });
const express = require('express');
const chits = require(path.join(HERE, 'routes', 'chits.js'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== WALK-D D-F-01..05 · a goods-in that cannot move stock is refused in words ==\n');
  ok('routes/chits.js exports the real sendReceiptLines', typeof chits.sendReceiptLines === 'function');
  const app = express();
  app.use(express.json());
  app.post('/send', async (req, res) => {
    const state = { sender_id: SHOP, purpose: req.body.purpose, is_draft: !!req.body.is_draft, business_json: req.body.business_json || {}, line_items: req.body.line_items };
    if (await chits.sendReceiptLines(state, req, res)) return;
    if (!res.headersSent) res.json({ message: 'Chit sent successfully' });
  });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port + '/send';
  const post = async (body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const line = (over, data) => Object.assign({ particulars: 'WKD Yoghurt', quantity: 5, price: 4, item_data: Object.assign({ item_id: PLAIN }, data || {}) }, over || {});
  const receipt = (l, extra) => Object.assign({ purpose: 'receipt', line_items: [l] }, extra || {});
  const refused = (name, r, code, words) => ok(name, r.status === 400 && r.body.code === code && (!words || new RegExp(words).test(String(r.body.detail || r.body.message))) && r.body.type, JSON.stringify(r));

  refused('D-F-01 qty 0 → 400 BAD_QTY', await post(receipt(line({ quantity: 0 }))), 'BAD_QTY', 'above 0');
  refused('D-F-01 qty -3 → 400 BAD_QTY', await post(receipt(line({ quantity: -3 }))), 'BAD_QTY');
  refused('D-F-01 no cost → 400 BAD_PRICE', await post(receipt(line({ price: undefined }))), 'BAD_PRICE', 'no cost price');
  refused('D-F-01 cost -1 → 400 BAD_PRICE', await post(receipt(line({ price: -1 }))), 'BAD_PRICE');
  refused('D-F-01 batch-kept item with no lot → 400 RECEIPT_LOT_REQUIRED', await post(receipt(line({}, { item_id: BATCHED }))), 'RECEIPT_LOT_REQUIRED', 'batch number');
  refused('D-F-02 qty 1e12 → 400 BAD_QTY', await post(receipt(line({ quantity: 1e12 }))), 'BAD_QTY', 'too large');
  ok('D-F-02 qty 999999999999 (just under 1e12) is not refused for size', (await post(receipt(line({ quantity: 999999999999 })))).status === 200);
  refused('D-F-03 ghost item id → 400 RECEIPT_ITEM_UNKNOWN', await post(receipt(line({}, { item_id: GHOST }))), 'RECEIPT_ITEM_UNKNOWN', 'not a product');
  refused('D-F-03 an item id that is no uuid → 400 RECEIPT_ITEM_UNKNOWN', await post(receipt(line({}, { item_id: 'not-a-uuid' }))), 'RECEIPT_ITEM_UNKNOWN');
  refused('D-F-04 lot expired 2025-01-01 → 400 RECEIPT_LOT_EXPIRED', await post(receipt(line({}, { lot: { batch: 'LX', expiry: '2025-01-01' } }))), 'RECEIPT_LOT_EXPIRED', '2025-01-01');
  refused('D-F-05 "12/03/25" → 400 RECEIPT_DATE_UNREADABLE', await post(receipt(line({}, { lot: { batch: 'L1', expiry: '12/03/25' } }))), 'RECEIPT_DATE_UNREADABLE', 'year-month-day');
  refused('D-F-05 "2026-13-45" → 400 RECEIPT_DATE_UNREADABLE', await post(receipt(line({}, { lot: { batch: 'L1', expiry: '2026-13-45' } }))), 'RECEIPT_DATE_UNREADABLE');

  const good = await post(receipt(line({}, { item_id: BATCHED, lot: { batch: 'L1', expiry: '2099-01-31' } })));
  ok('a good batch-kept receipt (lot L1, expiry 2099-01-31) → 200', good.status === 200, JSON.stringify(good));
  ok('a good plain receipt → 200', (await post(receipt(line()))).status === 200);
  ok('a draft with qty 0 → 200 (a draft is the author\'s own copy)', (await post(receipt(line({ quantity: 0 }), { is_draft: true }))).status === 200);
  ok('an order with qty 0 is refused here since AY-F-03 (an order for nothing is not an order): 400 BAD_QTY; a draft of it is not', (await post({ purpose: 'order', line_items: [line({ quantity: 0 })] })).status === 400 && (await post({ purpose: 'order', is_draft: true, line_items: [line({ quantity: 0 })] })).status === 200);
  ok('a receipt AGAINST a bill: no cost needed on the line (the bill carries it) → 200', (await post(receipt(line({ price: undefined }), { business_json: { against: { chit_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } } }))).status === 200);
  ok('a free-text receipt line (no product) with a cost → 200', (await post(receipt({ particulars: 'labour', quantity: 1, price: 5 }))).status === 200);

  const sql = require('fs').readFileSync(path.join(HERE, 'lib', 'stock-store.js'), 'utf8');
  ok('FEFO read skips expired lots (expires_at IS NULL OR expires_at >= CURRENT_DATE)', /AND \(expires_at IS NULL OR expires_at >= CURRENT_DATE\)\s+ORDER BY expires_at NULLS LAST/.test(sql));

  server.close();
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
