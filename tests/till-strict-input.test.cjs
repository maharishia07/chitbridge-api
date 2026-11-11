'use strict';
/**
 * tests/till-strict-input.test.cjs - S33 STRICT INPUT ON THE COUNTER'S WRITES, AND THE OFFLINE QUEUE STILL POSTS
 * Every POST of routes/till.js now names the keys it reads and refuses any other (additionalProperties false, lib/till-contract.js STRICT_BODY).
 * The counter replays SAVED bodies from its offline queue (till.html queueWrite / the agent's /api/op), possibly written by an older till, so:
 *   REPLAY  each route is sent the fullest body any till version has sent (the till master, its git history, the desktop agent tools/tally-connector/till.js):
 *           it is never answered "<key> is not accepted here" (UNKNOWN_FIELD). The one body that grew keys over time is POST /reward (net · gross · count · lines, sent until W2-REW).
 *   JUNK    the same body plus a key nobody sends is refused 400 TILL_BAD_REQUEST in the problem shape (RFC 9457 + the old { error, message }), naming the key.
 * Run: node tests/till-strict-input.test.cjs
 */
const G = require('./support/route-golden.cjs');

const SHOP = '11111111-1111-4111-8111-111111111111';
const ID = '33333333-3333-4333-8333-333333333333';
const h = G.harness({ known: { [SHOP]: 'SHOP' }, rows: () => [] });
const till = require('../routes/till');
const { ROUTES } = require('../lib/till-contract');
/* the counter sends an Idempotency-Key on the points writes (till.html idemHeaders), so the replay carries one too */
const app = require('express')();
app.use((req, res, next) => { req.headers['idempotency-key'] = 'replay-' + Math.random().toString(36).slice(2); next(); });
app.use(h.app('/api/till', till));

/** the fullest saved body per route: what the till master sends today, plus what its older versions and the desktop agent sent */
const SAVED = {
  'POST /alias': { item_id: ID, by: 'Anand', text: 'Tomato 5kg', unit: 'kg', factor: 5 },
  'POST /catalogue': { blueprint: 'general', products: [{ name: 'Tea', price: 10 }], replace: false },
  'POST /close': { last_no: 'C1/26-27/0042', bills: 42, next: 43, period: '26-27' },
  'POST /diagnostic': { code: 'AB12', verdict: 'queue stuck', till_id: 'C1', online: true, storage: true, queued: 3, foreign: 0, bills: 40, last_why: 'timeout', waiting: [{ no: 'C1/26-27/0042', tries: 2, why: 'timeout' }] },
  'POST /enrol': { name: 'Browser counter', counter: 'C1', takeover: false },
  'POST /flags': { item_id: ID, screen: true, offer_id: 'o1', excluded: false },
  'POST /listen': { audio: 'AAAA', mime: 'audio/webm', format: 'webm', lang: 'en-IN', hint: 'tea, sugar' },
  'POST /pair': {},
  'POST /pair/claim': { code: 'ABC234' },
  'POST /quick-keys/hide': { product_id: ID, shift_id: ID, by: ID, also_counters: true },
  'POST /quick-keys/screen-config': { config: { photos: true } },
  'POST /quick-keys/state': { business_date: '2026-11-11', shift_id: ID, active_group_ids: [ID] },
  'POST /quick-keys/unhide': { product_id: ID, also_counters: false },
  'POST /reconcile': { bills: [{ no: 'C1/26-27/0042', at: '2026-11-11T10:00:00Z', chit_id: ID }] },
  'POST /reward': { ref: 'C1/26-27/0042', holder: { scheme: 'phone', value: '9999999999' }, customer: '9999999999', spend: 10, at: '2026-11-11T10:00:00Z',
    net: 100, gross: 110, count: 1, lines: [{ item_id: ID, qty: 1, net: 100, category: 'tea' }] },
  'POST /reward/claim': { from: { scheme: 'phone', value: '9999999999' }, to: { scheme: 'identity', value: ID }, ref: 'C1/26-27/0042' },
  'POST /screens/rename': { jti: ID, name: 'Window TV' },
  'POST /screens/revoke': { jti: ID },
  'POST /shop': { trade_name: 'Anand Stores', legal_name: 'Anand', address: '1 Main Rd', city: 'Pune', state: 'MH', pincode: '411001', phone: '9999999999', email: 'a@b.in', gstin: '', currency: 'INR', reg_type: 'regular' },
  'POST /state': { state: 'break', since: '2026-11-11T10:00:00Z', by: 'Anand' },
  'POST /stock': { item_id: ID, status: 'unavailable', until: '2026-11-12', note: 'sold out', by: 'Anand' },
  'POST /stock/bulk': { item_ids: [ID], status: 'available', note: 'back', by: 'Anand' },
};
const unknownKeyRefusal = (r) => r.status === 400 && r.body && Array.isArray(r.body.errors) && r.body.errors.some((e) => e.code === 'UNKNOWN_FIELD');
const send = (route, body) => h.run(app, { method: 'POST', url: '/api/till' + route.split(' ')[1], body, identity: { identity_id: SHOP }, settle: 5 });

let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } };
const must = (c, why) => { if (!c) throw new Error(why); };

(async () => {
  const strict = Object.keys(SAVED);
  await it('every route of this list is declared strict in the contract', async () => {
    strict.forEach((route) => must(ROUTES[route] && ROUTES[route].rules && ROUTES[route].rules.additionalProperties === false, route + ' is not strict'));
  });
  for (const route of strict) {
    await it(route + ' · a saved old-queue body is not refused for its keys', async () => {
      const r = await send(route, SAVED[route]);
      must(!unknownKeyRefusal(r), 'refused: ' + JSON.stringify(r.body));
    });
    await it(route + ' · an unknown key is refused 400 in the problem shape, naming it', async () => {
      const r = await send(route, Object.assign({}, SAVED[route], { zz_junk: 1 }));
      must(r.status === 400, 'status ' + r.status + ' ' + JSON.stringify(r.body));
      const b = r.body;
      must(b.code === 'TILL_BAD_REQUEST' && b.status === 400 && b.type && b.title && b.detail && b.request_id !== undefined, 'not the problem shape: ' + JSON.stringify(b));
      must(b.field === 'zz_junk' && b.errors[0].code === 'UNKNOWN_FIELD' && b.error === 'validation' && /zz_junk/.test(b.message), 'does not name the key / lost the old words: ' + JSON.stringify(b));
    });
  }
  console.log('\n' + (n - failed) + '/' + n + ' passed');
  process.exit(failed ? 1 : 0);
})();
