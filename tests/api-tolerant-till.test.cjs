#!/usr/bin/env node
// @type: contract
'use strict';
/**
 * api-tolerant-till.test.cjs - S33-T (Athi, 11 Nov 2026, "tolerant by design"): the proofs of the counter's QUEUED doors listed in
 * docs/contracts/api-hardening-scope.json tolerant_outward with this file as their test.
 *
 * OWNS      per door (POST /api/till/flags · stock · stock/bulk · reward · reward/claim · quick-keys/hide · quick-keys/unhide, and POST /api/chits/send):
 *           (a) the body the counter sends today is accepted; (b) the same body plus zz_unknown answers the same status and body, and the key reaches no database
 *           statement (ignored = never stored); (c) the keys older counters and the desktop agent sent (reward: net · gross · count · lines; null for "none") are accepted;
 *           (d) a JUNK VALUE of the wrong kind in a known key is refused 400 in the problem shape, naming the key, and the refusal is a 400 (not 401/403: the counter's
 *           drain STOPS the whole queue on those two, and PARKS a 400 row while the rows behind it go).
 * CALLED BY scripts/guards.cjs . CI. No database, no network. tools/api-register.cjs --check refuses a listed door whose test file does not name the route, zz_unknown and problem.
 * FLOW      DOORS table -> the real router over http (tests/support/route-golden.cjs) -> status + body + the statements sent -> checks
 * CARD      28-platform-and-operations/api-standard
 * Run: node tests/api-tolerant-till.test.cjs
 */
const G = require('./support/route-golden.cjs');

const SHOP = '11111111-1111-4111-8111-111111111111';
const ITEM = '33333333-3333-4333-8333-333333333333';
const COUNTER_ROW = { counter: 't1', jti: 'k1', item_id: ITEM, item_data: { name: 'Tea' } };
const h = G.harness({ known: { [SHOP]: 'SHOP' }, rows: (sql) => (/idempotency/i.test(sql) ? [] : [COUNTER_ROW]) });
const till = require('../routes/till');
const chits = require('../routes/chits');
/* the counter sends an Idempotency-Key on the points writes (till.html idemHeaders), so every request here carries a fresh one */
const mountApp = (mount, router) => {
  const app = require('express')();
  app.use((req, res, next) => { req.headers['idempotency-key'] = 'tol-' + Math.random().toString(36).slice(2); next(); });
  app.use(h.app(mount, router));
  return app;
};
const tillApp = mountApp('/api/till', till);
const chitsApp = mountApp('/api/chits', chits);

const CANARY = { zz_unknown: 'zz_unknown_canary_value' };
const HOLDER = { scheme: 'phone', value: '9840012345' };
const DOORS = [
  { route: 'POST /api/till/flags', app: tillApp, url: '/api/till/flags', good: { item_id: ITEM, screen: true }, junk: { item_id: { not: 'an id' } } },
  { route: 'POST /api/till/flags', app: tillApp, url: '/api/till/flags', label: 'offer opt-out', good: { item_id: ITEM, offer_id: 'o1', excluded: true }, junk: { excluded: ['yes'] } },
  { route: 'POST /api/till/stock', app: tillApp, url: '/api/till/stock', good: { item_id: ITEM, status: 'unavailable', by: null, until: null, note: null }, junk: { by: { name: 'x' } } },
  { route: 'POST /api/till/stock/bulk', app: tillApp, url: '/api/till/stock/bulk', good: { item_ids: [ITEM], status: 'available', by: null }, junk: { item_ids: 'not-a-list' } },
  { route: 'POST /api/till/reward', app: tillApp, url: '/api/till/reward', good: { ref: 'B-1', holder: HOLDER, spend: 0, at: '2026-11-11T10:00:00Z' }, junk: { holder: 'a phone number' },
    old: { ref: 'B-1', holder: HOLDER, spend: 0, net: 500, gross: 520, count: 2, lines: [{ item_id: ITEM, qty: 1, net: 500, category: 'tea' }] } },
  { route: 'POST /api/till/reward/claim', app: tillApp, url: '/api/till/reward/claim', good: { from: HOLDER, to: { scheme: 'identity', value: SHOP }, ref: 'claim-1' }, junk: { from: 'a phone number' } },
  { route: 'POST /api/till/quick-keys/hide', app: tillApp, url: '/api/till/quick-keys/hide', till: { key: { jti: 'k1' } }, good: { product_id: ITEM, also_counters: ['T2'] }, junk: { also_counters: 'T2' },
    old: { product_id: ITEM, also_counters: null, shift_id: null, by: null } },
  { route: 'POST /api/till/quick-keys/unhide', app: tillApp, url: '/api/till/quick-keys/unhide', till: { key: { jti: 'k1' } }, good: { product_id: ITEM, also_counters: [] }, junk: { product_id: ['a'] } },
  { route: 'POST /api/chits/send', app: chitsApp, url: '/api/chits/send', good: { purpose: 'invoice', self_copy: 'sent', line_items: [], business_json: {}, recipients: [{ self: true }] }, junk: { self_copy: 'everyone' } }
];

const send = (door, body) => h.run(door.app, { method: 'POST', url: door.url, body, identity: { identity_id: SHOP }, till: door.till, settle: 5 });
const asText = (rec) => JSON.stringify({ status: rec.status, body: rec.body });
const problemShape = (rec) => rec.body && rec.body.code && rec.body.status === rec.status && rec.body.type && rec.body.title;
const namesKey = (rec, key) => JSON.stringify(rec.body).includes(key);

let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); } };
const must = (cond, why) => { if (!cond) throw new Error(why); };

(async () => {
  for (const door of DOORS) {
    const name = door.route + (door.label ? ' (' + door.label + ')' : '');
    const plain = await send(door, door.good);
    await it(name + ' - the body the counter sends is not refused for its keys or kinds', async () => {
      must(plain.status !== 400 || !(plain.body && plain.body.errors) , 'refused by the schema: ' + asText(plain));
      must(plain.status < 500, 'a fault: ' + asText(plain));
    });
    await it(name + ' - an unknown key (zz_unknown) is ignored: same status and answer, and it reaches no statement', async () => {
      const extra = await send(door, Object.assign({}, door.good, CANARY));
      must(asText(extra) === asText(plain), 'differs: ' + asText(extra) + ' vs ' + asText(plain));
      must(!JSON.stringify(extra.calls).includes('zz_unknown') && !JSON.stringify(extra.body).includes('zz_unknown'), 'the unknown key travelled');
    });
    if (door.old) {
      await it(name + ' - the keys older counters sent (and null for none) are accepted', async () => {
        const old = await send(door, Object.assign({}, door.old, CANARY));
        must(!(old.status === 400 && namesKey(old, 'zz_unknown')) && !(old.status === 400 && old.body && old.body.errors), 'refused: ' + asText(old));
      });
    }
    await it(name + ' - a junk value in a known key is refused 400 in the problem shape, never 401/403', async () => {
      const bad = await send(door, Object.assign({}, door.good, door.junk));
      must(bad.status === 400 && problemShape(bad), 'got ' + asText(bad));
      const key = Object.keys(door.junk)[0];
      must(namesKey(bad, key), 'the refusal does not name ' + key + ': ' + asText(bad));
    });
  }
  console.log('\n' + (n - failed) + '/' + n + ' passed');
  process.exit(failed ? 1 : 0);
})();
