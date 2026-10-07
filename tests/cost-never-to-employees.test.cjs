/**
 * cost-never-to-employees.test.cjs — [OFFR-04] the buying price never leaves for an actor without can_see_costs,
 * on EVERY read that carries it: products export.csv · workbook.xlsx · /:id/versions (?at=) · till /stock ·
 * till /match · supplies list. Owner always sees it; an actor only with identities.can_see_costs.
 *
 * ONE mechanism: lib/cost.js canRead (via canReadSafe). offr04-cost-gate covers GET/PATCH /api/products;
 * this covers the routes that test did not. Offline: real express routers, stubbed auth + db.
 *
 * Run: node tests/cost-never-to-employees.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
const zlib = require('zlib');

const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(78) + got + (ok ? '' : '   want ' + want));
};

const OWNER   = { identity_id: 'e1', identity_type: 'entity', display_name: 'Owner' };
const BLIND   = { identity_id: 'a1', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', display_name: 'Blind' };
const GRANTED = { identity_id: 'a2', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', display_name: 'Granted' };
let WHO = OWNER;
const CAN = { a2: true };
const SECRET = 4242.5;   // a cost no other field could carry

const get = (port, p) => new Promise((ok) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => ok({ status: res.statusCode, buf: Buffer.concat(chunks) }));
  });
});
/* an .xlsx is a zip: inflate every entry so the body can be searched as text, not as compressed bytes */
function unzipText(buf) {
  let out = '';
  for (let i = 0; i + 30 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8), csize = buf.readUInt32LE(i + 18);
    const n = buf.readUInt16LE(i + 26), x = buf.readUInt16LE(i + 28);
    const start = i + 30 + n + x;
    const data = buf.slice(start, start + csize);
    try { out += (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8') + '\n'; } catch (_) { /* skip */ }
    i = start + csize - 1;
  }
  return out;
}

const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };

mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
  requireScope: () => (req, res, next) => next(),
}));

const ITEM = { item_id: 'i1', name: 'Masala Dosa', price: 70, cost: SECRET, status: 'available' };
const dbq = async (sql, params) => {
  if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: !!CAN[params[0]] }] };
  if (/SELECT item_data FROM catalogue_items/.test(sql)) return { rows: [{ item_data: Object.assign({}, ITEM) }] };
  if (/SELECT item_id FROM catalogue_items/.test(sql)) return { rows: [{ item_id: 'i1' }] };
  if (/FROM catalogue_item_version/.test(sql)) {
    return { rows: [{ version_no: 1, snapshot: Object.assign({}, ITEM), name: 'Masala Dosa', price: 70, valid_from: 'x', valid_to: null }] };
  }
  if (/FROM supply_item/.test(sql)) return { rows: [{ supply_item_id: 's1', name: 'Foil', unit: 'roll', keep_stock: false, last_cost: SECRET }] };
  if (/FROM stock_balance/.test(sql)) return { rows: [{ item_id: 'i1', lot: '', qty: 2, value: 2 * SECRET, avg_cost: SECRET }] };
  if (/h\.chit_id = ANY/.test(sql)) {
    return { rows: [{ chit_id: 'c1', business_json: { side: 'buy' }, line_items: [{ line_id: 'l1', particulars: 'Rice', quantity: 2, unit: 'kg', price: 10 }] }] };
  }
  if (/h\.purpose = 'receipt'/.test(sql)) {
    return { rows: [{ chit_id: 'r1', created_at: '2026-10-02', business_json: { against: { chit_id: 'c1' }, doc_no: 'GRN1', goods: 20, landed_total: SECRET }, line_items: [] }] };
  }
  return { rows: [] };
};
mock('/db', { query: dbq, withEntity: async (_id, fn) => fn({ query: dbq }), readBatch: async () => [] });
mock('/lib/schedule', { enabled: async () => false, TABLE: 'x', pending: async () => [], applyDue: async () => {} });

const has = (s) => String(s).includes('4242');

(async () => {
  /* the till's /match reads documents through three helpers; stub only those, the cost gate under test is real */
  const select = require(API + '/lib/select');
  select.rows = async () => ([{ chit_id: 'c1', created_at: '2026-10-01', counterparty_id: 'p1', manual_subject: 'PO' }]);
  require(API + '/lib/policy').get = async () => ({});
  require(API + '/lib/deliverline').progress = async () => new Map();

  const app = express();
  app.use(express.json());
  app.use('/api/products', require(API + '/routes/products'));
  app.use('/api/supplies', require(API + '/routes/supplies'));
  let till = null, tillErr = null;
  try { till = require(API + '/routes/till'); app.use('/api/till', till); } catch (e) { tillErr = e; }
  const srv = app.listen(0); const port = srv.address().port;

  const cases = [['owner', OWNER, true], ['actor WITHOUT can_see_costs', BLIND, false], ['actor WITH can_see_costs', GRANTED, true]];
  console.log('\n-- [OFFR-04] cost on every route that carries it --\n');

  for (const [who, ident, sees] of cases) {
    const want = sees ? 'cost present' : 'no cost';
    const show = (x) => (x ? 'cost present' : 'no cost');
    WHO = ident;

    let r = await get(port, '/api/products/export.csv');
    t(who + ' | export.csv answers 200', r.status, 200);
    t(who + ' | export.csv body: ' + want, show(has(r.buf.toString('utf8'))), want);
    if (!sees) t(who + ' | export.csv still carries the product', r.buf.toString('utf8').includes('Masala Dosa'), true);

    r = await get(port, '/api/products/workbook.xlsx');
    t(who + ' | workbook.xlsx answers 200', r.status, 200);
    const x = unzipText(r.buf);
    t(who + ' | workbook.xlsx body: ' + want, show(has(x)), want);
    if (!sees) t(who + ' | workbook.xlsx still carries the product', x.includes('Masala Dosa'), true);

    r = await get(port, '/api/products/i1/versions?at=2026-10-01T00:00:00Z');
    t(who + ' | /versions?at= JSON: ' + want, show(has(r.buf.toString())), want);
    r = await get(port, '/api/products/i1/versions');
    t(who + ' | /versions (history) JSON: ' + want, show(has(r.buf.toString())), want);
    t(who + ' | /versions keeps the price either way', r.buf.toString().includes('"price":70'), true);

    r = await get(port, '/api/supplies');
    t(who + ' | supplies list JSON: ' + want, show(has(r.buf.toString())), want);
    t(who + ' | supplies list keeps the name', r.buf.toString().includes('Foil'), true);

    if (till) {
      r = await get(port, '/api/till/stock');
      t(who + ' | till /stock JSON: ' + want, show(has(r.buf.toString())), want);
      t(who + ' | till /stock keeps the qty', JSON.parse(r.buf.toString()).balances.i1.qty, 2);
      r = await get(port, '/api/till/match');
      t(who + ' | till /match answers 200', r.status, 200);
      t(who + ' | till /match (landed): ' + want, show(has(r.buf.toString())), want);
      t(who + ' | till /match keeps the receipt', r.buf.toString().includes('GRN1'), true);
    }
  }
  if (!till) t('till router loads offline (' + (tillErr && tillErr.message) + ')', 'no', 'yes');

  srv.close();
  console.log('\n  ' + (pass + fail) + ' checks' + (fail ? ' | ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
