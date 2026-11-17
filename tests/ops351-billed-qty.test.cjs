/**
 * tests/ops351-billed-qty.test.cjs - OPS-351: GET /api/till/match sets what their invoice BILLS beside what was received, per line (lines[].billed); billed above received is a difference.
 *
 * OWNS      billed more than received = differs, open or closed, even when nothing arrived (Oracle Qty Rec hold, SAP DQ/DW); billed stays null (unknown, never 0) for a total-only bill, a name that
 *           joins nothing or twice, several or disagreeing invoices, a door-keyed bill, a quantity that is not positive; another unit = null + billed_unit; blank unit = as ordered; KG = kg;
 *           an absorbed gap is no flag; unmatched invoice lines are counted (billed_unmatched), never judged; a cost-blind reader keeps the quantities.
 * CALLED BY scripts/guards.cjs . CI. No database, no network: the real routes/till.js over a stubbed db (the ops82 shape).
 * FLOW      order lines + deliveries + invoices -> real route -> orders[].lines[].billed / billed_unit / billed_more, billed_unmatched, verdict, differences
 * CARD      12-suppliers-and-procurement/purchase-order-and-goods-receipt
 *
 * Run: node tests/ops351-billed-qty.test.cjs
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
const U = (n) => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PO = U(1), BOLT = U(101), NUT = U(102);
const line = (id, name, quantity, unit) => ({ line_id: id, particulars: name, quantity, unit: unit || 'piece', price: 10 });
const bl = (name, quantity, unit) => Object.assign({ particulars: name, quantity }, unit === undefined ? {} : { unit });
let STATUS = 'pending', ORDER = [], DELIVERED = {}, INVOICES = [], RECEIPTS = [], BLIND = false, POLICY = {};
const head = () => ({ chit_id: PO, created_at: '2026-10-25T10:00:00Z', purpose: 'order', direction: 'sent', current_status: STATUS, sender_entity_id: E1, all_recipients: [{ entity_id: S }], counterparty_id: S, counterparty_name: 'Mill', summary_json: {}, entity_id: E1 });
const invoice = (n, lines, total) => ({ chit_id: U(30 + n), created_at: '2026-10-26T10:00:00Z', sender_entity_id: S, summary_json: total == null ? {} : { total_value: total },
  business_json: { bill_no: 'INV-' + n, order: { from: PO } }, line_items: lines });

const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = BLIND ? { identity_id: 'a1', identity_type: 'actor', access_level: 'editor', parent_entity_id: E1 } : { identity_id: E1, identity_type: 'entity' }; next(); }, {
  entityOf: () => E1, requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity }));
const dbq = async (sql) => {
  const text = String(sql).replace(/\s+/g, ' ');
  if (/can_see_costs FROM identities/.test(text)) return { rows: [{ can_see_costs: !BLIND }] };
  if (/currency_code, country FROM identities/.test(text)) return { rows: [{ currency_code: 'INR', country: 'IN' }] };
  if (/h[.]purpose = 'receipt'/.test(text)) return { rows: RECEIPTS };
  if (/h[.]direction = 'received' AND h[.]purpose = 'invoice'/.test(text)) return { rows: INVOICES };
  if (/FROM chit_header h LEFT JOIN chit_detail d/.test(text)) return { rows: [{ chit_id: PO, line_items: ORDER, business_json: { side: 'buy' } }] };
  return { rows: [] };
};
mock('/db', { query: dbq, withEntity: async (_id, fn) => fn({ query: dbq }), readBatch: async () => [] });
const get = (port, p) => new Promise((ok, bad) => http.get({ host: '127.0.0.1', port, path: p }, (res) => {
  let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => ok(JSON.parse(raw)));
}).on('error', bad));

(async () => {
  require(API + '/lib/select').rows = async () => [head()];
  require(API + '/lib/policy').get = async () => POLICY;
  require(API + '/lib/deliverline').progress = async () => new Map(Object.entries(DELIVERED).map(([id, delivered]) => [id, { delivered }]));
  const app = express(); app.use('/api/till', require(API + '/routes/till'));
  const srv = app.listen(0), port = srv.address().port;
  /* one world per read: order lines, what arrived per line id, the invoices, the order's status */
  const read = async (w) => {
    ORDER = w.order; DELIVERED = w.got || {}; INVOICES = w.invoices || []; STATUS = w.status || 'pending'; RECEIPTS = w.receipts || []; BLIND = !!w.blind; POLICY = w.policy || {};
    return (await get(port, '/api/till/match')).orders[0];
  };
  const h11 = [line(BOLT, 'Bolt', 10), line(NUT, 'Nut', 5)];
  const nut = (o) => o.lines.find((x) => x.name === 'Nut');
  const what = (o) => [nut(o).billed, o.verdict, o.differences];
  const arrived = { [BOLT]: 10, [NUT]: 4 };
  console.log('\n== OPS-351 . what their invoice bills, beside what came ==\n');

  let o = await read({ order: h11, got: arrived, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 5)])] });
  t('a  H11 shape: open order, Nut billed 5 received 4: differs, 1 difference', what(o), [5, 'differs', 1]);
  t('a2 the line says it: billed_more true; Bolt billed 10 = received 10 is not flagged', [nut(o).billed_more, o.lines[0].billed_more], [true, undefined]);
  o = await read({ order: h11, got: arrived, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 4)])] });
  t('b  billed 4 received 4, ordered 5, order open: open, no difference', what(o), [4, 'open', 0]);
  o = await read({ order: h11, got: { [BOLT]: 10, [NUT]: 5 }, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 4)])] });
  t('c  billed 4 received 5: billed below received is not flagged', what(o), [4, 'agreed', 0]);
  o = await read({ order: h11, got: {}, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 5)])] });
  t('d  NOTHING received, billed 15 pieces: differs, not awaited (the rule sits before awaited)', [o.verdict, o.differences], ['differs', 2]);
  o = await read({ order: h11, got: arrived, invoices: [invoice(1, undefined, 1250)] });
  t('e  total-only bill (no line_items): billed null, open stays open', [nut(o).billed, o.verdict, o.billed_unmatched], [null, 'open', 0]);
  o = await read({ order: h11, got: arrived, receipts: [{ chit_id: U(21), created_at: '2026-10-25T12:00:00Z', line_items: [], business_json: { against: { chit_id: PO }, their_bill: { no: 'P1', total: 1250 } } }] });
  t('f  a bill keyed at the door (total only): billed null, open', [nut(o).billed, o.verdict], [null, 'open']);
  o = await read({ order: h11, got: arrived, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 4), bl('Washer', 7)])] });
  t('g  an invoice line naming no order line: counted in billed_unmatched, verdict unchanged (open)', [o.billed_unmatched, o.verdict, o.differences], [1, 'open', 0]);
  o = await read({ order: h11, got: arrived, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 5), bl('Nut', 5)])] });
  t('h  the name twice on the invoice: billed null (not guessed), verdict open', [nut(o).billed, o.verdict], [null, 'open']);
  o = await read({ order: [line(BOLT, 'Nut', 5), line(NUT, 'Nut', 5)], got: { [BOLT]: 4, [NUT]: 4 }, invoices: [invoice(1, [bl('Nut', 9)])] });
  t('h2 the name twice on the ORDER: billed null on both lines', [o.lines.map((x) => x.billed), o.verdict], [[null, null], 'open']);
  o = await read({ order: h11, got: arrived, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 2, 'box')])] });
  t('i  invoice in box, order in piece: billed null, billed_unit box, never differs on it', [nut(o).billed, nut(o).billed_unit, o.verdict], [null, 'box', 'open']);
  o = await read({ order: h11, got: arrived, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 5, '')])] });
  t('j  blank invoice unit reads as the ordered unit: billed 5 > 4 differs', [nut(o).billed, nut(o).billed_unit, o.verdict], [5, undefined, 'differs']);
  o = await read({ order: [line(BOLT, 'Rice', 10, 'kg')], got: { [BOLT]: 8 }, invoices: [invoice(1, [bl('Rice', 10, 'KG')])] });
  t('k  KG and kg are one unit: billed 10 > 8 differs', [o.lines[0].billed, o.verdict], [10, 'differs']);
  o = await read({ order: [line(BOLT, 'Rice', 10, 'kg')], got: { [BOLT]: 9.96 }, invoices: [invoice(1, [bl('Rice', 10, 'kg')])] });
  t('l  billed 10 against 9.96 received, inside the trade tolerance: no flag', [o.lines[0].billed_more, o.differences], [undefined, 0]);
  o = await read({ order: h11, got: arrived, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 5)]), invoice(2, [bl('Bolt', 10), bl('Nut', 5)])] });
  t('m  two invoices name the order: billed null (neither picked), open', [nut(o).billed, o.verdict], [null, 'open']);
  const split = invoice(1, [bl('Bolt', 10), bl('Nut', 5)]); split.summary_json = { stamps: { engine: 1 }, money: { total: 1250 }, total_value: 1000 };
  o = await read({ order: h11, got: arrived, invoices: [split] });
  t('m2 one invoice whose copies disagree on the total: billed null, open', [nut(o).billed, o.verdict], [null, 'open']);
  for (const bad of [-3, 0, 'x', null]) {
    o = await read({ order: h11, got: arrived, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', bad)])] });
    t('n  quantity ' + JSON.stringify(bad) + ' is no figure: billed null, open', [nut(o).billed, o.verdict], [null, 'open']);
  }
  o = await read({ order: h11, got: arrived, blind: true, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 5)])] });
  t('o  a cost-blind reader keeps billed, billed_more, billed_unmatched (quantities, not money)', [nut(o).billed, nut(o).billed_more, o.billed_unmatched, o.verdict], [5, true, 0, 'differs']);
  o = await read({ order: h11, status: 'completed', got: arrived, invoices: [invoice(1, [bl('Bolt', 10), bl('Nut', 5)])] });
  t('p  completed order, billed 5 received 4: differs, ONE difference (the short is not counted twice)', what(o), [5, 'differs', 1]);
  o = await read({ order: h11, got: { [BOLT]: 12, [NUT]: 4 }, invoices: [invoice(1, [bl('Bolt', 12), bl('Nut', 4)])] });
  t('p2 an excess line billed as received: one difference (the excess), billed not above received', [o.differences, o.lines[0].billed_more], [1, undefined]);
  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
