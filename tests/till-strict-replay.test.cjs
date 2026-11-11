'use strict';
/**
 * tests/till-strict-replay.test.cjs - S33 STRICT INPUT ON THE TWO COUNTER DOORS THE TILL NEVER SENDS (quick-keys/state, quick-keys/screen-config)
 * (tests/till-strict-input.test.cjs covers the live doors closed by batch 2026-11-11; flags, stock, stock/bulk and reward stay OPEN: the till queues those offline
 * and an older queued body must not wedge, PM/ATHI-DECISIONS 2026-11-09.) No till version has ever sent these two (till.html + history + agent: only the idempotency key
 * helper names reward/claim, which no caller uses), so no old queued body exists.
 *   REPLAY  the body the handler reads (and a null-valued twin) is never answered UNKNOWN_FIELD.
 *   JUNK    the same body plus an unknown key is refused 400 TILL_BAD_REQUEST in the problem shape, naming the key.
 * Run: node tests/till-strict-replay.test.cjs
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
  'POST /quick-keys/screen-config': { config: { photos: true } },
  'POST /quick-keys/state': { business_date: '2026-11-11', shift_id: ID, active_group_ids: [ID] },
};
/** the same bodies with the nulls a till sends for "none" (by: null, shift_id: null) */
const NULLED = {
  'POST /quick-keys/state': { business_date: '2026-11-11', shift_id: null, active_group_ids: [] },
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
      for (const body of [SAVED[route], NULLED[route]].filter(Boolean)) { const r = await send(route, body); must(!unknownKeyRefusal(r), 'refused: ' + JSON.stringify(r.body)); }
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
