/**
 * tests/ops100-match-open.test.cjs - OPS-100: GET /api/till/match says "open" (waiting for the rest), not "differs", while a delivery is still open; a short this trade absorbs is no difference.
 *
 * OWNS      one order of 10 kg: 8 received on an open order (open, 0 differences) · 9.96 on a completed order (inside tolerance: agreed, 0) · 8 on a completed order (differs, 1) · 12 on an open order (differs, 1).
 * CALLED BY scripts/guards.cjs . CI. No database, no network: the real routes/till.js over a stubbed db (the ops82 shape).
 * FLOW      status + delivered quantity -> real route -> orders[].verdict / differences
 * CARD      12-suppliers-and-procurement/purchase-order-and-goods-receipt
 *
 * Run: node tests/ops100-match-open.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');

const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(100) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const E1 = 'e1', S = '33333333-3333-4333-8333-333333333333';
const PO = '30000000-0000-4000-8000-000000000001', LINE = '30000000-0000-4000-8000-000000000101';
let STATUS = 'pending', DELIVERED = 0;
const head = () => ({ chit_id: PO, created_at: '2026-10-25T10:00:00Z', purpose: 'order', direction: 'sent', current_status: STATUS, sender_entity_id: E1, all_recipients: [{ entity_id: S }], counterparty_id: S, counterparty_name: 'Mill', summary_json: {}, entity_id: E1 });
const detail = { line_items: [{ line_id: LINE, particulars: 'Rice', quantity: 10, unit: 'kg', price: 100 }], business_json: { side: 'buy' } };

const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: E1, identity_type: 'entity' }; next(); }, {
  entityOf: () => E1, requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity }));
const dbq = async (sql) => {
  const text = String(sql).replace(/\s+/g, ' ');
  if (/can_see_costs FROM identities/.test(text)) return { rows: [{ can_see_costs: true }] };
  if (/FROM chit_header h LEFT JOIN chit_detail d/.test(text) && !/purpose = 'receipt'|purpose = 'invoice'/.test(text)) return { rows: [Object.assign({ chit_id: PO }, detail)] };
  return { rows: [] };
};
mock('/db', { query: dbq, withEntity: async (_id, fn) => fn({ query: dbq }), readBatch: async () => [] });
const get = (port, p) => new Promise((ok, bad) => http.get({ host: '127.0.0.1', port, path: p }, (res) => {
  let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => ok(JSON.parse(raw)));
}).on('error', bad));

(async () => {
  require(API + '/lib/select').rows = async () => [head()];
  require(API + '/lib/policy').get = async () => ({});
  require(API + '/lib/deliverline').progress = async () => new Map([[LINE, { delivered: DELIVERED }]]);
  const app = express(); app.use('/api/till', require(API + '/routes/till'));
  const srv = app.listen(0), port = srv.address().port;
  const read = async (status, delivered) => { STATUS = status; DELIVERED = delivered; return (await get(port, '/api/till/match')).orders[0]; };
  console.log('\n== OPS-100 . an open delivery waits for the rest ==\n');
  let o = await read('pending', 8);
  t('open order, 8 of 10 received: verdict open, no difference', [o.verdict, o.differences], ['open', 0]);
  o = await read('completed', 9.96);
  t('closed order, short inside the trade tolerance (absorbed): agreed, no difference', [o.verdict, o.differences], ['agreed', 0]);
  o = await read('completed', 8);
  t('closed order, 8 of 10 never accepted: a real difference, differs', [o.verdict, o.differences], ['differs', 1]);
  o = await read('pending', 12);
  t('open order, 12 of 10 (excess): differs whatever the status', [o.verdict, o.differences], ['differs', 1]);
  o = await read('pending', 0);
  t('open order, nothing received: awaited', [o.verdict, o.differences], ['awaited', 0]);
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
