/**
 * tests/support/work-stub.cjs — the offline stand-in for the Tasks & Orders read: a stubbed database (select's one statement and the page's ONE readBatch,
 * both filtered by the entity param the way RLS filters), the real router routes/work.js, the real lib/work-rows · select · open-orders · assign · deliverline
 * and the adopted engines. Used by tests/work-rows.test.cjs and tests/support/contract-work.cjs (the contract's /api/work half).
 *   const S = require('./support/work-stub.cjs');  S.seed() · S.as({…identity}, isKey) · await S.start() · await S.get(url) · S.stop() · S.D (data, trips)
 */
'use strict';
const path = require('path'), http = require('http');
const API = path.join(__dirname, '..', '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stubMod = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

const E1 = 'e1', E2 = 'e2';
const U = (n) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
const D = { copies: [], detail: {}, marks: [], progress: [], assign: [], tables: true, statements: [], trips: 0, batches: 0, bigRows: null };
const reset = () => { D.statements = []; D.trips = 0; D.batches = 0; };

const copy = (n, o) => Object.assign({ chit_id: U(n), current_status: 'pending', direction: 'received', folder_id: null, read_at: null, archived_at: null,
  assigned_to_actor_id: null, assigned_to_actor_display_name: null, filed_at: null, touched_at: null, manual_subject: null, auto_subject: 'Order ' + n,
  created_at: new Date(Date.now() - n * 3600e3).toISOString(), purpose: 'order', sender_entity_id: 'cust-' + n, sender_entity_display_name: 'Customer ' + n,
  all_recipients: [], summary_json: {}, value: '1200.50', currency: 'INR', open_disputes: 0, resolved_disputes: 0, counterparty_id: 'cust-' + n,
  counterparty_name: 'Customer ' + n, doc_kind: null, bill_no: null, alt_value: null, biz_kind: null, biz_side: null, entity_id: E1 }, o);
const line = (id, qty, price) => ({ line_id: id, particulars: 'Item ' + id, quantity: qty, unit: 'kg', price });
const prog = (chit, lid, ordered, got) => ({ chit_id: chit, line_id: lid, particulars: 'Item', ordered_unit: 'kg', ordered, removed: false,
  delivery_id: got ? 'd-' + lid : null, dq: got || null, du: 'kg', recorded_by_entity_id: E1, delivered_at: '2026-10-01T00:00:00Z' });

function seed() {
  D.copies = [
    /* c1 an ONLINE order in (sell, pending, 2 lines, one fully sent), assigned to A1 */
    copy(1, { summary_json: { order_details: { channel: 'online', fulfilment: 'pickup', address: null, requested_delivery: '2026-10-12', remark: 'Ring first', name: 'Meena' } }, assigned_to_actor_id: 'A1', assigned_to_actor_display_name: 'Asha' }),
    /* c2 a self-PO (received, declared buy) → Orders OUT; billed */
    copy(2, { biz_side: 'buy', current_status: 'accepted', sender_entity_id: E1 }),
    /* c3 an order I SENT (buy by direction) */
    copy(3, { direction: 'sent', sender_entity_id: E1, current_status: 'accepted' }),
    /* c4 a task: a general chit that came to me, assigned to A1 */
    copy(4, { purpose: 'general', assigned_to_actor_id: 'A1', assigned_to_actor_display_name: 'Asha', value: null }),
    /* c5 a closed order in */
    copy(5, { current_status: 'completed' }),
    /* c6 a supplier's counter bill: leaves the Task / Order lists */
    copy(6, { purpose: 'invoice', doc_kind: 'bill_received' }),
    /* c7 a purchase order to myself (declared buy): two copies, one chit */
    copy(7, { sender_entity_id: E1, direction: 'sent', biz_side: 'buy' }), copy(7, { sender_entity_id: E1, direction: 'received', biz_side: 'buy' }),
    /* c8 something I sent that is not an order: nobody's task */
    copy(8, { purpose: 'general', direction: 'sent', sender_entity_id: E1 }),
    /* c9 another order in, rejected */
    copy(9, { current_status: 'rejected' }),
    /* the other shop's own order (RLS: E1 must never see it) */
    copy(10, { entity_id: E2, sender_entity_id: 'x' }),
  ];
  D.detail = {
    [U(1)]: { line_items: [line(U(101), 5, 100), line(U(102), 3, 250)], business_json: { order_no: 'SO-1' } },
    [U(2)]: { line_items: [line(U(201), 2, 10)], business_json: { side: 'buy' } },
    [U(3)]: { line_items: [], business_json: {} },
  };
  D.progress = [prog(U(1), U(101), 5, 5), prog(U(1), U(102), 3, 1), prog(U(2), U(201), 2, 0)];
  D.marks = [{ against: null, billed: U(2) }];
  D.assign = [
    { chit_id: U(1), line_id: U(101), seq: 1, assignee_actor_id: 'A9', assignee_name: 'Ravi', assignee_type: 'human', task: 'pick', due_date: '2026-10-11', note: null, created_at: '2026-10-09T00:00:00Z', state: 'open' },
    { chit_id: U(1), line_id: U(101), seq: 2, assignee_actor_id: 'A1', assignee_name: 'Asha', assignee_type: 'human', task: 'pack', due_date: '2026-10-12', note: 'fragile', created_at: '2026-10-10T00:00:00Z', state: 'open' },
  ];
  D.tables = true; D.bigRows = null;
}

/* the select resolver's one statement: filtered by the entity param, like the RLS it runs under */
function selectAnswer(sql, p) {
  D.statements.push(sql);
  if (D.bigRows) return { rows: D.bigRows };
  let rows = D.copies.filter((r) => r.entity_id === p[0]);
  if (/cs\.chit_id = \$/.test(sql)) { const id = p.find((v) => /^[0-9a-f-]{36}$/.test(String(v)) && v !== p[0]); rows = rows.filter((r) => r.chit_id === id); }
  return { rows: rows.map((r) => Object.assign({}, r)) };
}
const fakeDb = { query: async (sql, p) => selectAnswer(String(sql).replace(/\s+/g, ' '), p || []) };
stubMod('db/index.js', {
  withEntity: async (entity, fn) => { D.trips += 4; return fn(fakeDb); },
  onEntity: async (entity, db, fn) => (db && db.query ? fn(db) : fn(fakeDb)),
  query: async (sql) => { D.statements.push(String(sql)); return { rows: D.tables ? [{ '?column?': 1 }] : [] }; },
  readBatch: async (entity, actor, stmts) => {
    D.trips += 1; D.batches++;
    return stmts.map((s) => {
      const t = String(s.text).replace(/\s+/g, ' ');
      D.statements.push(t);
      const mine = (r) => D.copies.some((c) => c.chit_id === r.chit_id && c.entity_id === s.params[0]);
      if (/FROM chit_header h LEFT JOIN chit_detail d/.test(t)) return { rows: s.params[1].filter((id) => mine({ chit_id: id })).filter((id) => D.detail[id]).map((id) => Object.assign({ chit_id: id }, D.detail[id])) };
      if (/SELECT DISTINCT CASE/.test(t)) return { rows: D.marks };
      if (/FROM chit_line l LEFT JOIN chit_line_delivery/.test(t)) return { rows: D.progress.filter((r) => s.params[1].includes(r.chit_id)) };
      if (/FROM chit_line_assignment/.test(t)) return { rows: D.assign.filter((r) => s.params[1].includes(r.chit_id)) };
      throw new Error('unexpected statement: ' + t.slice(0, 80));
    });
  },
});
/* the books and schema probes the shared libs may ask: not part of this test */
const IDENT = { identity_id: 'A1', identity_type: 'entity', entity_id: E1 };
let WHO = Object.assign({}, IDENT), KEY = false;
stubMod('middleware/auth.js', Object.assign((req, res, next) => { req.identity = WHO; if (KEY) req.api_key = { id: 'k' }; next(); },
  { entityOf: (req) => req.identity.entity_id || req.identity.identity_id, requireScope: () => (q, r, n) => n(), userOf: (r) => r.identity }));
stubMod('lib/access.js', Object.assign({}, require('../../lib/access'), { levelOf: (idn) => (idn && idn.level) || 'editor' }));

const express = require('express');
const app = express(); app.use('/api/work', require('../../routes/work'));
const srv = http.createServer(app);

function get(url) {
  return new Promise((resolve, reject) => {
    http.get({ port: srv.address().port, path: url }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
const as = (o, key) => { WHO = Object.assign({}, IDENT, o); KEY = !!key; };
async function start() { await new Promise((r) => srv.listen(0, '127.0.0.1', r)); }
function stop() { srv.close(); }
module.exports = { D, E1, E2, U, copy, seed, reset, as, get, start, stop };
