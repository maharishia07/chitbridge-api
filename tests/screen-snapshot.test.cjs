'use strict';
/**
 * tests/screen-snapshot.test.cjs — ⭐⭐⭐ A SHOP SCREEN GETS ONLY WHAT A SCREEN SHOWS (SNAP-SCREEN, 2026-10-14 · case CFD-03).
 *
 * The counter reconciliation (14 Oct) found a TV / customer-display key receiving the counter's whole snapshot: customers with
 * phone and balance, suppliers, staff. CFD-03 says "no customer detail ever reaches the screen" — and "the queue behind can read
 * that screen". This asserts it over the JSON that actually leaves the route, for a screen key and for a counter key, and over
 * the bell a screen listens on.
 *
 * Run: node tests/screen-snapshot.test.cjs   · no DB, no network (the app listens on a port the OS chooses).
 * The DB/auth stub is the one tests/round-trips-till.test.cjs uses; only the holder is real (lib/holder.js).
 */
const path = require('path');
const API = path.join(__dirname, '..');
const { holderOf } = require(path.join(API, 'lib', 'holder'));

let queries = [];
function rowsFor(sql) {
  if (/FROM identities WHERE identity_id/.test(sql)) return [{ display_name: 'Shop', gstn: null, country: 'IN', policy_flags: {}, user_id: 'shop' }];
  if (/FROM identities\s+WHERE parent_entity_id/.test(sql)) return [{ identity_id: 'a1', display_name: 'Cashier Meena', hat: 'editor' }];
  if (/FROM entity_profile/.test(sql)) return [{ trade_mode: null, markets: null, sectors: ['grocery'], adopted: null }];
  if (/count\(\*\)::int AS n FROM catalogue_items/.test(sql)) return [{ n: 2 }];
  if (/FROM catalogue_items/.test(sql)) return [
    { item_id: 'i1', item_data: { name: 'Rice', price: 60, unit: 'kg', hsn: '1006', avail: { qty: 41 },
                                  aliases: [{ by: 'Sri Ganesh Provisions', text: 'PONNI-25' }], pricing_def_name: 'Wholesale' },
      is_active: true, updated_at: '2026-09-29T10:00:00.000Z' },
    { item_id: 'i2', item_data: { name: 'Dal', price: 120, unit: 'kg', status: 'unavailable' }, is_active: true, updated_at: '2026-09-29T10:00:01.000Z' }];
  if (/FROM supplier_list/.test(sql)) return [{ id: 's1', name: 'Sri Ganesh Provisions', nickname: null, gstn: '33BBBBB1111B1Z5', country: 'IN', party_no: 'P-00001' }];
  if (/FROM customer_list/.test(sql)) return [{ identity_id: 'c1', display_name: 'Kumar', phone: '9840012345', groups: [], last_txn_at: null }];
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);
const withEntity = async (id, fn) => fn({ query: async (s) => { queries.push(String(s)); return { rows: rowsFor(String(s)) }; } });
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql) => { queries.push(String(sql)); return { rows: rowsFor(String(sql)) }; },
  withEntity, withTransaction: (fn) => withEntity(null, fn),
  onEntity: async (id, db, fn) => (db && typeof db.query === 'function') ? fn(db) : withEntity(id, fn),
  readBatch: async (id, actor, stmts) => stmts.map((s) => { queries.push(String(s.text)); return { rows: rowsFor(String(s.text)) }; }),
}) };
/* ⭐ the key arrives as a header ONLY in this test: the stub builds req.till with the REAL holderOf, as middleware/auth does */
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => {
    req.identity = { identity_id: 'e1', identity_type: 'entity' };
    const scopes = String(req.headers['x-test-scopes'] || 'till').split(',');
    req.api_key = { jti: 'k-' + scopes.join('-'), scopes };
    req.till = holderOf({ kind: 'api_key', jti: req.api_key.jti, scopes }, null, null);
    next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
    requireScope: () => (req, res, next) => next(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };

const express = require('express');
const app = express();
const till = require(path.join(API, 'routes', 'till'));
app.use('/api/till', till);
app.use('/api/events', require(path.join(API, 'routes', 'events')));
const events = require(path.join(API, 'lib', 'events'));

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); }
};
/* what a screen must NEVER be sent — keys anywhere in the JSON, and the people's words themselves */
const NEVER_KEYS = ['customers', 'suppliers', 'staff', 'reward', 'policy', 'till', 'books', 'lot_fields', 'slabs', 'face',
  'aliases', 'alias_text', 'avail', 'hsn', 'tax_slab', 'pricing_tiers', 'pricing_def_name', 'modifiers', 'cost', 'cost_minor',
  'balance_minor', 'open_bills', 'credit_limit_minor', 'gstin', 'legal_name', 'pay', 'handle'];
const NEVER_WORDS = ['Kumar', '9840012345', 'Sri Ganesh Provisions', 'Cashier Meena', 'PONNI-25', 'Wholesale'];
function keysOf(v, out) {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { out.add(k); keysOf(v[k], out); });
  return out;
}
async function snap(scopes, qs) {
  queries = [];
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/till/snapshot${qs || ''}`, { headers: { 'x-test-scopes': scopes } });
  return { status: r.status, text: await r.text(), queries: queries.slice() };
}

const srv = app.listen(0, '127.0.0.1', async () => {
  try {
    console.log('— a SCREEN key (CFD-03: no customer detail ever reaches the screen) —');
    const s = await snap('screen');
    t('a screen key\'s snapshot answers 200', s.status === 200, s.text.slice(0, 200));
    const sb = JSON.parse(s.text), sk = keysOf(sb, new Set());
    NEVER_KEYS.forEach((k) => t('no `' + k + '` anywhere in a screen\'s snapshot', !sk.has(k)));
    NEVER_WORDS.forEach((w) => t('"' + w + '" is not in a screen\'s snapshot', s.text.indexOf(w) < 0));
    t('it still paints: the shop\'s name and money', sb.shop && sb.shop.name && 'currency' in sb.shop, JSON.stringify(sb.shop));
    t('it still paints: the product on the shelf, with name and price', Array.isArray(sb.items) && sb.items.length === 1
      && sb.items[0].name === 'Rice' && sb.items[0].price === 60, JSON.stringify(sb.items));
    t('an unavailable product is never advertised (not sent to a screen)', !sb.items.some((i) => i.name === 'Dal'));
    t('the offers travel', Array.isArray(sb.offers));
    t('⚠️ a screen never claims a bill series (no FOR UPDATE on the shop row)', !s.queries.some((q) => /FOR UPDATE/.test(q)));
    const sd = JSON.parse((await snap('screen', '?since=2026-09-29T09:00:00.000Z')).text);
    t('on a delta, an item no longer available leaves the screen as a removal', (sd.removed || []).indexOf('i2') >= 0, JSON.stringify(sd.removed));

    console.log('— a COUNTER key — unchanged —');
    const c = await snap('till');
    const cb = JSON.parse(c.text);
    t('a counter key\'s snapshot answers 200', c.status === 200);
    ['customers', 'suppliers', 'staff', 'policy', 'lot_fields', 'slabs', 'version'].forEach((k) => t('a counter still receives `' + k + '`', k in cb));
    t('a counter still sees its customer', c.text.indexOf('Kumar') >= 0);
    t('a counter still sees the unavailable product (to put it back on the shelf)', cb.items.some((i) => i.name === 'Dal'));
    t('a counter still sees the supplier\'s alias', cb.items.some((i) => Array.isArray(i.aliases) && i.aliases.length));
    t('a key with screen AND till is a counter, not a screen', 'customers' in JSON.parse((await snap('screen,till')).text));

    console.log('— the allow-list holds for a field added tomorrow —');
    const v = till.screenView({ at: 'x', shop: { name: 'S', currency: 'INR', secret: 1 }, items: [{ item_id: 'a', name: 'A', status: 'available', cost_minor: 5 }],
                               offers: [], new_people_list: [{ name: 'Kumar' }] });
    t('a top-level key the allow-list does not name does not reach a screen', !('new_people_list' in v));
    t('a shop field the allow-list does not name does not reach a screen', !('secret' in v.shop));
    t('an item field the allow-list does not name does not reach a screen', !('cost_minor' in v.items[0]));

    console.log('— the bell a screen listens on —');
    const fake = () => { const w = []; return { w, writeHead() {}, write(p) { w.push(p); }, on() {}, end() {} }; };
    const req = { on() {} };
    const scr = fake(), ctr = fake();
    const ts = events.spendFor(events.ticketFor('e9', { screen: true }).ticket);
    const tc = events.spendFor(events.ticketFor('e9').ticket);
    t('a screen ticket is marked; a counter ticket is not', ts.screen === true && tc.screen === false);
    events.subscribe(ts.entity_id, req, scr, { screen: ts.screen });
    events.subscribe(tc.entity_id, req, ctr, { screen: tc.screen });
    const n0 = scr.w.length;
    events.emit(['e9'], { kind: 'chit', id: 'ch1', who: 'Sri Ganesh Provisions', note: 'order' });
    t('a chit event (with a counterparty\'s name) is NOT written to a screen', scr.w.length === n0);
    t('…and still reaches the counter', ctr.w.some((p) => p.indexOf('Sri Ganesh Provisions') >= 0));
    events.emit(['e9'], { kind: 'shop', what: 'catalogue' });
    const last = scr.w[scr.w.length - 1] || '';
    t('a shop event reaches the screen as { at, kind } only', /"kind":"shop"/.test(last) && !/what/.test(last), last);
    const screenRoute = await fetch(`http://127.0.0.1:${srv.address().port}/api/events/ticket`, { method: 'POST', headers: { 'x-test-scopes': 'screen' } });
    const tk = (await screenRoute.json()).ticket;
    t('POST /api/events/ticket with a screen key mints a screen ticket (isScreenKey, on the server)', events.spendFor(tk).screen === true);
  } catch (e) { fail++; console.log('  FAIL the test ran   ' + (e && e.stack)); }
  console.log(`\n  ${pass} checks · ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
  srv.close();
  setTimeout(() => process.exit(process.exitCode), 50).unref();
});
