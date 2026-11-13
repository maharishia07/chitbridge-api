#!/usr/bin/env node
/**
 * ops-58-short-delivery-match.test.cjs — OPS-58 (proof 2026-11-14), half 1: the W73 rail bill is SEEN as a difference by the three-way match.
 * @type regression
 * OWNS      W73 (WALK-2026-10-18): PO 60 Parotta at 12 = 720, received 50 (600), the supplier's invoice (rail) says 720. GET /api/till/match must say: ordered 60, received 50,
 *           line state 'short' (diff -10), received_with_tax 600, invoiced 720, money_gap -120, money_code 'apart', verdict 'differs' (the owner is shown the 120, never "agreed").
 *           Control: the same bill after 60 are received agrees (gap 0, verdict 'agreed'), so the verdict follows the figures, not the shape of the world.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/till.js over a stubbed db (the ops83 pattern).
 * FLOW      PO 60 · receipt (counted 50, taxable 600) · invoice 720 -> real route -> orders[0] lines[0].state / money_gap / verdict
 * CARD      12-suppliers-and-procurement/purchase-order-and-goods-receipt
 *   node tests/ops-58-short-delivery-match.test.cjs
 */
'use strict';
const express = require('express');
const http = require('http');
const { API, ok, done, mock } = require('./lib/cat-proof-kit.cjs');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';

const E1 = 'e1', S = '33333333-3333-4333-8333-333333333333';
const U = (n) => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PO = U(1), LINE = U(101);
const head = { chit_id: PO, created_at: '2026-10-18T10:00:00Z', purpose: 'order', direction: 'sent', current_status: 'pending', sender_entity_id: E1, all_recipients: [{ entity_id: S }], counterparty_id: S, counterparty_name: 'Mill' };
const detail = { line_items: [{ line_id: LINE, particulars: 'Parotta', quantity: 60, unit: 'pc', price: 12 }], business_json: { side: 'buy' } };
const receipt = (taxable) => ({ chit_id: U(21), created_at: '2026-10-18T12:00:00Z', line_items: [], business_json: { against: { chit_id: PO }, input_tax: { taxable, tax: 0 } } });
const invoice = { chit_id: U(31), created_at: '2026-10-19T10:00:00Z', sender_entity_id: S, summary_json: { total_value: 720 }, business_json: { bill_no: 'INV-73', order: { from: PO } }, line_items: [] };
let RECEIPTS = [], RECEIVED = 0;

mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: E1, identity_type: 'entity' }; next(); }, { entityOf: () => E1, requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity }));
const dbq = async (sql) => {
  const text = String(sql).replace(/\s+/g, ' ');
  if (/can_see_costs FROM identities/.test(text)) return { rows: [{ can_see_costs: true }] };
  if (/currency_code, country FROM identities/.test(text)) return { rows: [{ currency_code: 'INR', country: 'IN' }] };
  if (/h[.]purpose = 'receipt'/.test(text)) return { rows: RECEIPTS };
  if (/h[.]direction = 'received' AND h[.]purpose = 'invoice'/.test(text)) return { rows: [invoice] };
  if (/FROM chit_header h LEFT JOIN chit_detail d/.test(text)) return { rows: [Object.assign({ chit_id: PO }, detail)] };
  return { rows: [] };
};
mock('/db', { query: dbq, withEntity: async (_id, fn) => fn({ query: dbq }), readBatch: async () => [] });
const get = (port, p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => resolve(JSON.parse(raw))); }).on('error', reject));

(async () => {
  require(API + '/lib/select').rows = async () => [Object.assign({}, head)];
  require(API + '/lib/policy').get = async () => ({});
  require(API + '/lib/deliverline').progress = async () => new Map([[LINE, { delivered: RECEIVED }]]);
  const app = express(); app.use('/api/till', require(API + '/routes/till'));
  const srv = app.listen(0), port = srv.address().port;
  const read = async () => (await get(port, '/api/till/match')).orders[0];

  RECEIVED = 50; RECEIPTS = [receipt(600)];
  const o = await read();
  const line = (o.lines || [])[0] || {};
  ok('W73: ordered 60, received 50, the line is short by 10', line.ordered === 60 && line.received === 50 && line.state === 'short', JSON.stringify(line));
  ok('W73: counted 600 against their invoice 720 -> gap -120, apart', o.received_with_tax === 600 && o.invoiced_total === 720 && o.money_gap === -120 && o.money_code === 'apart', JSON.stringify([o.received_with_tax, o.invoiced_total, o.money_gap, o.money_code]));
  ok('W73: the verdict is "differs", never "agreed"', o.verdict === 'differs', o.verdict);

  RECEIVED = 60; RECEIPTS = [receipt(720)];
  const full = await read();
  ok('control: all 60 received (720) agrees with the 720 bill', full.money_gap === 0 && full.verdict === 'agreed', JSON.stringify([full.money_gap, full.verdict]));
  srv.close();
  done();
})();
