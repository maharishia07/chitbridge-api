/**
 * tests/sec3-device-keys.test.cjs — SEC3: DEVICE KEYS STAY INSIDE THEIR SHOP AND THEIR SWITCH; NOTHING IS LOST SILENTLY.
 *
 *   A  a device key naming a FOREIGN identity in `to` is refused in words (403 DEVICE_TO_REFUSED) and nothing is minted;
 *      the shop itself and a party on its customer/supplier list are allowed; /erp-ingest holds the same rule
 *   B  the shop's connector capability OFF → every device-key request refused (403 CAPABILITY_OFF), /ingest and /erp-ingest
 *   C  GET /api/events/stats → a shop user is refused (403 NOT_PLATFORM_ROOT); the platform root reads it; no key scope lists it
 *   D  the chit failing → the answer is NOT 2xx (503 CHIT_NOT_DELIVERED) so the device keeps the event
 *   E  the signal chit carries the shop's money (its own, else its pack's) — never 'INR' by default; unstated → null + NO_MONEY
 *   F  Zoho: the org's tax list failing → the order is NOT booked untaxed; it waits (a 'failed' receipt, retried)
 *   G  the gateway simulator: the local stack by default, http only to localhost, production only by --production
 * No database: db is stubbed; the routes are the real ones.   Run: node tests/sec3-device-keys.test.cjs
 */
'use strict';
const path = require('path'), assert = require('assert'), http = require('http');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'sec3-test';
const ROOT = '99999999-9999-4999-8999-999999999999';
process.env.PLATFORM_ROOT_ENTITY = ROOT;

const SHOP = '11111111-1111-4111-8111-111111111111', ACTOR = '22222222-2222-4222-8222-222222222222';
const PARTY = '33333333-3333-4333-8333-333333333333', STRANGER = '44444444-4444-4444-8444-444444444444';

/* ── the stand-in database ── */
let S = {};
function reset() { S = { caps: ['connector'], type: 'iot', currency: 'AUD', country: 'AU', parties: [PARTY], sql: [] }; }
function rowsFor(sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim(); S.sql.push(s);
  if (/FROM identities a LEFT JOIN identities p/.test(s))
    return [{ identity_id: ACTOR, parent_entity_id: SHOP, display_name: 'Pi', connector_type: S.type, status: 'active', connector_config: {}, shop_capabilities: S.caps }];
  if (/SELECT capabilities FROM identities/.test(s)) return [{ capabilities: S.caps }];
  if (/SELECT bridge_id, display_name, currency_code, country FROM identities/.test(s))
    return [{ bridge_id: 'CBSHOP', display_name: 'Mayur', currency_code: S.currency, country: S.country }];
  if (/AS party/.test(s) && /customer_list/.test(s)) {
    const on = S.parties.indexOf(p[1]) >= 0;
    return [{ display_name: on ? 'Chola' : 'Stranger', party: on, may: on }];
  }
  if (/SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = \$1 AND status = 'active'/.test(s))
    return [{ identity_id: p[0], bridge_id: 'CBX', display_name: 'X' }];
  if (/INSERT INTO connector_receipt/.test(s)) return [{ receipt_id: 'r1' }];
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p), rowCount: 1 }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => ({ rows: rowsFor(s, p), rowCount: 1 }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx),
} };
let WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur' };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
const realAuth = require(authPath);   /* the real KEY_ROUTES, asked directly in C */
const allowsKey = realAuth.allowsKey;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = Object.assign({}, WHO); next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n() }) };
try { const sc = require(path.join(API, 'lib', 'schema')); sc.hasColumn = async () => true; sc.hasTable = async () => true; } catch (_) { /* schema stub is optional */ }
const wpPath = require.resolve(path.join(API, 'lib', 'workpattern'));
require.cache[wpPath] = { id: wpPath, filename: wpPath, loaded: true, exports: { resolveWorkPattern: async () => ({}) } };

const mint = require(path.join(API, 'lib', 'mint'));
let DELIVERED = [], DELIVER_FAILS = null;
mint.deliver = async (sender, chit_id, copies) => { if (DELIVER_FAILS) throw DELIVER_FAILS; DELIVERED.push({ chit_id, copies }); };

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/connectors', require(path.join(API, 'routes', 'connectors')));
app.use('/api/events', require(path.join(API, 'routes', 'events')));

let pass = 0, fail = 0;
const ok = (what, cond, extra) => { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  FAIL ' + what + (extra ? '\n      ' + JSON.stringify(extra).slice(0, 400) : '')); } };

function call(server, method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ method, host: '127.0.0.1', port: server.address().port, path: url,
      headers: Object.assign({ 'Content-Type': 'application/json' }, data ? { 'Content-Length': Buffer.byteLength(data) } : {}, headers || {}) }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j; try { j = JSON.parse(b); } catch (_) { j = b; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const KEY = { 'X-Bridge-Key': 'device-key-1' };

(async () => {
  const server = app.listen(0);
  try {
    console.log('— A · whom a device may address —');
    reset(); DELIVERED = [];
    let r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4, to: STRANGER }, KEY);
    ok('A1 `to` = a foreign identity → 403 DEVICE_TO_REFUSED, in words', r.status === 403 && r.body.code === 'DEVICE_TO_REFUSED' && /customers or suppliers/.test(r.body.message), r);
    ok('A2 … and nothing was minted', DELIVERED.length === 0);
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4, to: 'not-a-uuid' }, KEY);
    ok('A3 `to` that is not an id → refused in words, not a 500', r.status === 403 && r.body.code === 'DEVICE_TO_REFUSED', r);
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4, to: PARTY }, KEY);
    ok('A4 `to` = one of the shop\'s own parties → 200, the party holds a copy', r.status === 200 && DELIVERED.length === 1 && DELIVERED[0].copies.some((c) => String(JSON.stringify(c)).includes(PARTY)), r);
    DELIVERED = [];
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4, to: SHOP }, KEY);
    ok('A5 `to` = the shop itself → 200', r.status === 200 && DELIVERED.length === 1, r);
    reset(); S.type = 'erp';
    r = await call(server, 'POST', '/api/connectors/erp-ingest', { payload: { doc_type: 'invoice' }, to: STRANGER }, KEY);
    ok('A6 /erp-ingest holds the same rule', r.status === 403 && r.body.code === 'DEVICE_TO_REFUSED', r);

    console.log('— B · the capability switch —');
    reset(); S.caps = ['core']; DELIVERED = [];
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4 }, KEY);
    ok('B1 capability off → /ingest 403 CAPABILITY_OFF, in words', r.status === 403 && r.body.code === 'CAPABILITY_OFF' && /switched its connector capability off/.test(r.body.message), r);
    ok('B2 … no heartbeat written, nothing minted', DELIVERED.length === 0 && !S.sql.some((s) => /UPDATE identities SET last_seen/.test(s)));
    S.type = 'erp';
    r = await call(server, 'POST', '/api/connectors/erp-ingest', { payload: { doc_type: 'invoice' } }, KEY);
    ok('B3 capability off → /erp-ingest 403 CAPABILITY_OFF', r.status === 403 && r.body.code === 'CAPABILITY_OFF', r);
    S.caps = null;
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp' }, KEY);
    ok('B4 no capabilities at all → refused the same way', r.status === 403 && r.body.code === 'CAPABILITY_OFF', r);
    r = await call(server, 'GET', '/api/connectors', null, {});
    ok('B5 the owner\'s routes read the same switch (one reader)', r.status === 403 && r.body.code === 'CAPABILITY_OFF', r);
    const src = require('fs').readFileSync(path.join(API, 'routes', 'connectors.js'), 'utf8');
    ok('B6 one reader: `indexOf(\'connector\')` appears once, in hasConnector', (src.match(/indexOf\('connector'\)/g) || []).length === 1 && /function hasConnector\(caps\)/.test(src));

    console.log('— C · /api/events/stats is the operator\'s —');
    WHO = { identity_id: SHOP, identity_type: 'entity' };
    r = await call(server, 'GET', '/api/events/stats');
    ok('C1 a shop user → 403 NOT_PLATFORM_ROOT', r.status === 403 && r.body.code === 'NOT_PLATFORM_ROOT', r);
    WHO = { identity_id: ACTOR, identity_type: 'actor', parent_entity_id: SHOP };
    r = await call(server, 'GET', '/api/events/stats');
    ok('C2 a shop\'s co-assist → 403', r.status === 403, r);
    WHO = { identity_id: ROOT, identity_type: 'entity' };
    r = await call(server, 'GET', '/api/events/stats');
    ok('C3 the platform root → 200 with the counts', r.status === 200 && r.body && typeof r.body === 'object', r);
    ok('C4 no key scope reaches GET /api/events/stats', !realAuth.SCOPE_NAMES.some((sc) => allowsKey([sc], 'GET', '/api/events/stats')));
    WHO = { identity_id: SHOP, identity_type: 'entity' };

    console.log('— D · a chit that failed is not a 200 —');
    reset(); DELIVER_FAILS = new Error('chit_deliver missing'); DELIVERED = [];
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4 }, KEY);
    ok('D1 delivery failed → 503 CHIT_NOT_DELIVERED (the device keeps the event)', r.status === 503 && r.body.code === 'CHIT_NOT_DELIVERED' && !/chit_deliver/.test(r.body.message), r);
    const pop = new Error('a test entity cannot trade with a production one'); pop.code = '23514';
    DELIVER_FAILS = pop;
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4 }, KEY);
    ok('D2 a refusal the database makes on purpose keeps its own code (knownerr)', r.status === 409 && r.body.code === 'POPULATION_BOUNDARY', r);
    DELIVER_FAILS = null;
    r = await call(server, 'POST', '/api/connectors/ingest', { heartbeat_only: true }, KEY);
    ok('D3 a heartbeat is still 200', r.status === 200 && r.body.health === 'live', r);

    console.log('— E · the shop\'s money —');
    const cur = () => DELIVERED[0].copies[0].summary_json ? DELIVERED[0].copies[0].summary_json.currency_code : JSON.parse(JSON.stringify(DELIVERED[0].copies[0])).summary_json.currency_code;
    reset(); DELIVERED = [];
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4 }, KEY);
    ok('E1 an AUD shop\'s signal chit is AUD', r.status === 200 && cur() === 'AUD' && r.body.money_why === null, { r, c: DELIVERED[0] && cur() });
    reset(); S.currency = null; S.country = 'IN'; DELIVERED = [];
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4 }, KEY);
    ok('E2 no money stated → the pack\'s (IN → INR)', r.status === 200 && cur() === 'INR', { c: DELIVERED[0] && cur() });
    reset(); S.currency = null; S.country = null; DELIVERED = [];
    r = await call(server, 'POST', '/api/connectors/ingest', { signal: 'temp', value: 4 }, KEY);
    ok('E3 neither → null, and the ONE sentence with code NO_MONEY', r.status === 200 && cur() === null && r.body.money_why && r.body.money_why.code === 'NO_MONEY'
      && r.body.money_why.why === require(path.join(API, 'lib', 'country-setup')).MONEY_UNSTATED, { r, c: DELIVERED[0] && cur() });
    ok('E4 no \'INR\' literal left on the signal chit', !/currency_code: 'INR'/.test(src));
    ok('E5 mint.summary: absent currency still INR; explicit null stays null', mint.summary({}).currency_code === 'INR' && mint.summary({ currency_code: null }).currency_code === null);
  } finally { server.close(); }

  console.log('— F · Zoho: a tax list that did not load holds the order —');
  const zoho = require(path.join(API, 'tools', 'tally-connector', 'adapters', 'zoho.js'));
  const realFetch = global.fetch; let invoices = 0;
  global.fetch = async (url, o) => {
    const u = String(url);
    const json = (status, j) => ({ ok: status < 400, status, text: async () => JSON.stringify(j), json: async () => j });
    if (/settings\/taxes/.test(u)) return json(500, { code: 1, message: 'internal error' });
    if (/\/contacts\?search_text/.test(u)) return json(200, { code: 0, contacts: [{ contact_id: 'c1', contact_name: 'Chola' }] });
    if (/\/organizations\//.test(u)) return json(200, { code: 0, organization: { tax_settings: { tax_reg_no: '33ABCDE1234F1Z5' } } });
    if (/\/invoices/.test(u) && o && o.method === 'POST') { invoices++; return json(200, { code: 0, invoice: { invoice_id: 'i1' } }); }
    return json(200, { code: 0 });
  };
  try {
    const ad = zoho({ zoho: { base: 'https://www.zohoapis.in', org: '1', token: 't' }, log: () => {} });
    const order = { chit_id: 'abcdef12-0000', buyer: 'Chola', lines: [{ name: 'Rice', qty: 1, price: 100, gst_rate: 5 }],
      b2b: { buyer: { name: 'Chola', gstin: '33XYZ', state_code: '33' }, place_of_supply: '33', taxes: { cgst: 2.5, sgst: 2.5 }, items: [] } };
    let err = null; try { await ad.pushOrder(order); } catch (e) { err = e; }
    ok('F1 tax list failed → pushOrder throws ZOHO_TAX_LIST, in words', err && err.code === 'ZOHO_TAX_LIST' && /order waits/.test(err.message), err && err.message);
    ok('F2 … and no invoice was posted untaxed', invoices === 0);
    const core = require(path.join(API, 'tools', 'tally-connector', 'core.js'));
    const rec = []; const receipts = { last: () => null, add: (x) => rec.push(x) };
    const cb = { policy: {}, chit: async () => ({ header: { chit_id: order.chit_id, current_status: 'completed', purpose: 'order' }, line_items: [] }),
      invoice: async () => ({}), books: async () => ({}) };
    const ad2 = { name: 'zoho', pushOrder: async () => { const e = new Error('Zoho tax list could not be read (x) — the order waits'); e.code = 'ZOHO_TAX_LIST'; throw e; } };
    const out = await core.pushOrder({ cb, adapter: ad2, receipts, log: () => {}, chit_id: order.chit_id }).catch((e) => ({ outcome: 'threw', why: e.message }));
    ok('F3 the kit keeps the order waiting: a \'failed\' receipt, retried at the next catch-up (never ok)', out.outcome === 'failed' && rec.some((x) => x.outcome === 'failed' && /tax list/.test(x.why)), { out, rec });
    ok('F4 … nothing recorded as booked', !rec.some((x) => x.outcome === 'ok'));
  } finally { global.fetch = realFetch; }

  console.log('— G · the gateway simulator points at the local stack —');
  const sim = require(path.join(API, 'scripts', 'connector-gateway-sim.js'));
  ok('G1 default → http://localhost:3000', sim.apiBase({}, []).base === 'http://localhost:3000');
  ok('G2 http to a non-local host → refused', !!sim.apiBase({ API_BASE: 'http://example.com' }, []).refuse);
  ok('G3 the production api without the flag → refused', !!sim.apiBase({ API_BASE: 'https://chitbridge-api-production.up.railway.app' }, []).refuse);
  ok('G4 --production → the production api', /railway\.app$/.test(sim.apiBase({}, ['--production']).base || ''));
  ok('G5 http://127.0.0.1:3000 allowed', sim.apiBase({ API_BASE: 'http://127.0.0.1:3000' }, []).base === 'http://127.0.0.1:3000');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
