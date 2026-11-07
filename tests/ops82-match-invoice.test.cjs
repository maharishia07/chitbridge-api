/**
 * tests/ops82-match-invoice.test.cjs — OPS-82: GET /api/till/match attaches to each purchase order the supplier invoice that BILLS it
 * (business_json.order.from = the order's chit id, the link the books read), never the first invoice from the same supplier.
 *
 * OWNS      two POs to one supplier + two invoices from it, listed in the wrong order, each gap 0; an invoice with total_value null is no figure (not 0);
 *           an invoice naming no order, or another supplier's, is attached to nothing; two invoices naming one order are named, none guessed.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/till.js over a stubbed db.
 * FLOW      world (orders · invoices) → real route → orders[].invoiced_total / invoiced_from / money_gap / verdict
 * CARD      12-suppliers-and-procurement/purchase-order-and-goods-receipt
 *
 * Run: node tests/ops82-match-invoice.test.cjs
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
const E1 = 'e1', S = '33333333-3333-4333-8333-333333333333', OTHER = '77777777-7777-4777-8777-777777777777';
const U = (n) => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PO1 = U(1), PO2 = U(2);
const po = (id, qty) => ({ head: { chit_id: id, created_at: '2026-10-25T10:00:00Z', purpose: 'order', direction: 'sent', current_status: 'pending', sender_entity_id: E1, all_recipients: [{ entity_id: S }], counterparty_id: S, counterparty_name: 'Mill', summary_json: {}, entity_id: E1 },
  detail: { line_items: [{ line_id: U(id.slice(-2) * 1 + 100), particulars: 'Rice', quantity: qty, unit: 'kg', price: 100 }], business_json: { side: 'buy' } } });
const inv = (n, sender, total, order, bill) => ({ chit_id: U(n), created_at: '2026-10-26T10:00:00Z', sender_entity_id: sender, summary_json: total === undefined ? {} : { total_value: total },
  business_json: Object.assign({}, bill ? { bill_no: bill } : {}, order ? { order: { from: order } } : {}), line_items: [] });
let ORDERS = [], INVOICES = [];
const POS = { [PO1]: po(PO1, 10), [PO2]: po(PO2, 2.5) }; /* po-1 worth 1000, po-2 worth 250 */

const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: E1, identity_type: 'entity' }; next(); }, {
  entityOf: () => E1, requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity }));
const dbq = async (sql, params) => {
  const text = String(sql).replace(/\s+/g, ' ');
  if (/can_see_costs FROM identities/.test(text)) return { rows: [{ can_see_costs: true }] };
  if (/h[.]purpose = 'receipt'/.test(text)) return { rows: [] };
  if (/h[.]direction = 'received' AND h[.]purpose = 'invoice'/.test(text)) return { rows: INVOICES };
  if (/FROM chit_header h LEFT JOIN chit_detail d/.test(text)) return { rows: params[1].filter((id) => POS[id]).map((id) => Object.assign({ chit_id: id }, POS[id].detail)) };
  return { rows: [] };
};
mock('/db', { query: dbq, withEntity: async (_id, fn) => fn({ query: dbq }), readBatch: async () => [] });
const get = (port, p) => new Promise((ok, bad) => http.get({ host: '127.0.0.1', port, path: p }, (res) => {
  let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => ok(JSON.parse(raw)));
}).on('error', bad));

(async () => {
  require(API + '/lib/select').rows = async () => ORDERS.map((o) => Object.assign({}, POS[o].head));
  require(API + '/lib/policy').get = async () => ({});
  const everything = new Map([[PO1, new Map([[U(101), { delivered: 10 }]])], [PO2, new Map([[U(102), { delivered: 2.5 }]])]]);
  require(API + '/lib/deliverline').progress = async (_e, id) => everything.get(id) || new Map();
  const app = express(); app.use('/api/till', require(API + '/routes/till'));
  const srv = app.listen(0), port = srv.address().port;
  const read = async () => { const b = await get(port, '/api/till/match'); return Object.fromEntries(b.orders.map((o) => [o.chit_id, o])); };
  console.log('\n══ OPS-82 · the match attaches the invoice that bills the order ══\n');
  ORDERS = [PO1, PO2];

  INVOICES = [inv(11, S, 250, PO2, 'INV-250'), inv(12, S, 1000, PO1, 'INV-1000')]; /* the 250 one comes FIRST */
  let m = await read();
  t('po-1 (1000) takes the 1000 invoice, not the first row: gap 0, agreed', [m[PO1].invoiced_total, m[PO1].money_gap, m[PO1].verdict], [1000, 0, 'agreed']);
  t('po-2 (250) takes the 250 invoice: gap 0, agreed', [m[PO2].invoiced_total, m[PO2].money_gap, m[PO2].verdict], [250, 0, 'agreed']);

  INVOICES = [inv(13, S, undefined, PO1, 'INV-N')];
  m = await read();
  t('an invoice with total_value not stated is no figure: invoiced_total null, no gap, never 0', [m[PO1].invoiced_total, m[PO1].money_gap, m[PO1].verdict], [null, null, 'agreed']);

  INVOICES = [inv(14, S, 250, null, 'INV-FREE'), inv(15, OTHER, 1000, PO1, 'INV-OTHER')];
  m = await read();
  t('an invoice naming no order, and one from another supplier, attach to nothing', [m[PO1].invoiced_total, m[PO1].invoiced_from], [null, null]);

  INVOICES = [inv(16, S, 1000, PO1, 'INV-A'), inv(17, S, 900, PO1, 'INV-B')];
  m = await read();
  t('two invoices naming one order: neither is picked, both are named, the figure stays unknown', [m[PO1].invoiced_total, m[PO1].money_gap, m[PO1].invoiced_from], [null, null, 'several invoices name this order: INV-A, INV-B']);
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
