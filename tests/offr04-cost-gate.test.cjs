/**
 * offr04-cost-gate.test.cjs — [OFFR-04] COST/MARGIN: OWNER ALWAYS, STAFF ONLY WITH can_see_costs GRANTED.
 *
 * Athi: "the cost information... should not be visible for employee ie the cost information unless the
 * access is provided." Then, deciding the boundary: "employees should not see without a specific
 * permission. otherwise, leave it with owner only." Then: "decide the role boundary and build the gate."
 *
 * ⚠️⚠️⚠️ REUSES lib/cost.js (b145), NOT A NEW MECHANISM. A first version of this feature invented its own
 * entity-wide policy_flags.offer_lab_costs_visible_to_staff switch, with its own PATCH/GET routes and its
 * own "Staff access" checkbox in Offer Lab — before finding that lib/cost.js already answers the identical
 * question with a per-actor identities.can_see_costs column, granted one co-assist at a time through the
 * EXISTING PATCH /api/actors/:id (already owner-only, already audited, already shown as a "Sees costs"
 * chip in app/cap-admin.js). That version is deleted; this drives the reused one through the real routes.
 *
 * ⚠️ NOT a unit test of cost.canRead() alone — that predicate has its own coverage. hat-gate.js's own
 * history is the reason this exists: a rule only a unit test has seen has not been proven wired to the
 * real request path. This drives GET /api/products, PATCH /api/products/:id, and
 * GET /api/entities/me/can-see-costs through real express with a stubbed auth/db — no live database.
 *
 * Run: node tests/offr04-cost-gate.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');

const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(70) + got + (ok ? '' : '   want ' + want));
};

const OWNER   = { identity_id: 'e1', identity_type: 'entity', display_name: 'Owner' };
const STAFF_BLIND   = { identity_id: 'a1', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', display_name: 'Blind Staff' };
const STAFF_GRANTED = { identity_id: 'a2', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', display_name: 'Granted Staff' };

const call = (port, method, path_, body) => new Promise((ok) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: path_, method,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch (_) { /* express's own HTML 404 for a route that does not exist */ }
      ok({ status: res.statusCode, body });
    }); });
  r.end(b);
});

async function productsCases() {
  console.log('\n-- [OFFR-04] GET/PATCH /api/products — cost stripped, availability-only PATCH for cost-blind staff --\n');

  let WHO = OWNER;
  /* keyed by identity_id, matching identities.can_see_costs — a real column, per actor, granted via the
     EXISTING PATCH /api/actors/:id, never a new entity-wide switch */
  let CAN_SEE_COSTS = {};
  let FLAGS_QUERY_THROWS = false;   // simulates a real production failure reading the column
  let WRITTEN = null;               // CAT-234: the params of the last UPDATE — what the route actually stored
  /* CAT-236: cost also hides deeper — an importer's option cost and a cost_* key — the strip is one rule at any depth */
  const FAKE_ITEM = {
    item_id: 'i1',
    item_data: { name: 'Masala Dosa', price: 70, cost: 30, cost_x: 9, status: 'available', modifiers: [{ name: 'Size', options: [{ name: 'Large', price: 90, cost: 40 }] }] }
  };
  /** CAT-234: does any key named cost or cost_* sit anywhere in this answer? (item, item_data, nested) */
  const hasCostKey = (value) =>
    !!value && typeof value === 'object' && Object.keys(value).some((k) => /^cost(_|$)/.test(k) || hasCostKey(value[k]));

  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
      entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
    }),
  };
  const SCHED = { enabled: async () => false, TABLE: 'x', pending: async () => [], applyDue: async () => {} };
  require.cache[require.resolve(API + '/lib/schedule')] = { exports: SCHED };
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      /* the shop has a currency, or stampItem refuses the price edit (no national default: the stand-in must say it) */
      query: async (sql) => (/currency_code, country FROM identities/.test(sql) ? { rows: [{ currency_code: 'INR', country: 'IN' }] } : { rows: [] }),
      /* lib/cost.js's canRead() reads can_see_costs through withEntity; the merge-patch read in PATCH
         also uses withEntity — both share this one stub */
      withEntity: async (_id, fn) => fn({
        query: async (sql, params) => {
          if (/can_see_costs FROM identities/.test(sql)) {
            if (FLAGS_QUERY_THROWS) throw new Error('simulated DB failure reading can_see_costs');
            return { rows: [{ can_see_costs: !!CAN_SEE_COSTS[params[0]] }] };
          }
          if (/SELECT item_data FROM catalogue_items/.test(sql)) return { rows: [{ item_data: JSON.parse(JSON.stringify(FAKE_ITEM.item_data)) }] };
          /* CAT-234: the stored row is what pg would RETURN — a fresh parse, so what the route does to the ANSWER cannot reach the store */
          if (/UPDATE catalogue_items/.test(sql)) {
            WRITTEN = params;
            return { rows: [JSON.parse(JSON.stringify(FAKE_ITEM))] };
          }
          return { rows: [] };
        },
      }),
      readBatch: async () => ([
        /* every row is a fresh parse (as pg gives it): a strip on one answer never reaches the store or the next case */
        { rows: [JSON.parse(JSON.stringify(FAKE_ITEM))] },
        { rows: [{ st: 'available' }] },
        { rows: [] },
        { rows: [{ n: 0 }] },
      ]),
    },
  };

  delete require.cache[require.resolve(API + '/routes/products')];
  const app = express();
  app.use(express.json());
  app.use('/api/products', require(API + '/routes/products'));
  const srv = app.listen(0);
  const port = srv.address().port;

  /* ── GET / — cost visible or stripped ── */
  WHO = OWNER;
  const asOwner = await call(port, 'GET', '/api/products');
  t('owner sees cost in the list — no DB read needed, cost.canRead() short-circuits for identity_type!==actor',
    asOwner.body.items[0].item_data.cost, 30);

  WHO = STAFF_BLIND; CAN_SEE_COSTS = {};
  const asBlind = await call(port, 'GET', '/api/products');
  t('cost-blind staff: cost is GONE from the response, not just hidden client-side',
    'cost' in (asBlind.body.items[0].item_data || {}), false);
  t('…at every depth: no cost / cost_* key anywhere in the listed item (CAT-236)', hasCostKey(asBlind.body.items[0]), false);
  t('…and every other field is untouched', asBlind.body.items[0].item_data.price, 70);

  WHO = STAFF_GRANTED; CAN_SEE_COSTS = { a2: true };
  const asGranted = await call(port, 'GET', '/api/products');
  t('once the OWNER grants can_see_costs on THIS co-assist’s own row, staff sees cost too', asGranted.body.items[0].item_data.cost, 30);

  WHO = STAFF_BLIND; CAN_SEE_COSTS = { a2: true };   // granted to a2, NOT a1
  const asUngranted = await call(port, 'GET', '/api/products');
  t('…and it is per-actor — a DIFFERENT co-assist with nothing granted still sees no cost',
    'cost' in (asUngranted.body.items[0].item_data || {}), false);

  /* ⚠️⚠️⚠️ THE FEATURE MUST NEVER BE ABLE TO BREAK THE CATALOGUE ITSELF */
  FLAGS_QUERY_THROWS = true;
  WHO = OWNER;
  const ownerDuringFailure = await call(port, 'GET', '/api/products');
  t('the can_see_costs read failing does NOT 500 the owner’s own list', ownerDuringFailure.status, 200);
  t('…and the owner still sees their own cost — cost.canRead(entity) never depended on that read anyway',
    ownerDuringFailure.body.items[0].item_data.cost, 30);

  WHO = STAFF_BLIND;
  const staffDuringFailure = await call(port, 'GET', '/api/products');
  t('and staff reading during the same failure gets a real list, not a 500', staffDuringFailure.status, 200);
  t('…failing to the SAFE side — cost hidden, same as if the column had read false',
    'cost' in (staffDuringFailure.body.items[0].item_data || {}), false);

  const staffPatchDuringFailure = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 1 } });
  t('a write during the same failure also fails closed — refused, not silently allowed', staffPatchDuringFailure.status, 403);
  FLAGS_QUERY_THROWS = false;

  /* ── PATCH /:id — availability only for cost-blind staff ── */
  WHO = OWNER; CAN_SEE_COSTS = {};
  WRITTEN = null;
  const ownerPrice = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 80 } });
  t('the owner may change price', ownerPrice.status, 200);
  /* CAT-237 (c): the owner's replace without merge:true is the old contract, untouched — the body IS the record written */
  t('…and without merge:true the owner REPLACES the record, as before (the written item_data carries no name)', /"name"/.test(String(WRITTEN && WRITTEN[1])), false);

  WHO = STAFF_BLIND;
  const blindPrice = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 80 } });
  t('cost-blind staff CANNOT change price — 403, not a silent 200', blindPrice.status, 403);
  t('…and the refusal points at Co-assists, the real place this is granted',
    /Co-assists/.test(blindPrice.body.message), true);

  const blindCost = await call(port, 'PATCH', '/api/products/i1', { item_data: { cost: 20 } });
  t('cost-blind staff cannot set cost either — the field this whole feature protects', blindCost.status, 403);

  /* CAT-237 (a): the same flip WITHOUT merge:true would replace the whole record with {status} — the price, cost and name erased by
     a caller who may touch none of them. Refused in words; nothing is written. */
  WRITTEN = null;
  const blindStatus = await call(port, 'PATCH', '/api/products/i1', { item_data: { status: 'unavailable' } });
  t('cost-blind staff flipping availability WITHOUT merge:true is refused — 403, not a silent wipe', blindStatus.status, 403);
  t('…under the one cost code the client already branches on', blindStatus.body.code, 'COST_BLIND');
  t('…naming every stored key the replace would have erased', (blindStatus.body.blocked || []).slice().sort().join(','), 'cost,cost_x,modifiers,name,price');
  t('…and saying what to send instead', /merge:true/.test(blindStatus.body.message), true);
  t('…nothing was written: no UPDATE ran', WRITTEN, null);
  t('…and the stored row keeps its price and cost', FAKE_ITEM.item_data.price + ' ' + FAKE_ITEM.item_data.cost, '70 30');

  /* CAT-234: the answer to that flip is the stored row — it must come back WITHOUT the cost, as GET / already does */
  WRITTEN = null;
  const blindMerge = await call(port, 'PATCH', '/api/products/i1', { merge: true, item_data: { status: 'unavailable' } });
  t('a cost-blind status flip with merge:true still answers 200', blindMerge.status, 200);
  t('…and no cost / cost_* key sits anywhere in the answered item', hasCostKey(blindMerge.body.item), false);
  t('…the other fields of the row still come back', ((blindMerge.body.item || {}).item_data || {}).price, 70);
  const blindOption = ((((blindMerge.body.item || {}).item_data || {}).modifiers || [{}])[0].options || [{}])[0];
  t('…a nested option keeps its name and price, loses its cost (CAT-236)', blindOption.name + ' ' + blindOption.price + ' ' + ('cost' in blindOption), 'Large 90 false');
  t('…and a cost_* key is gone too', 'cost_x' in ((blindMerge.body.item || {}).item_data || {}), false);
  t('the owner still reads the nested option cost', ((((ownerPrice.body.item || {}).item_data || {}).modifiers || [{}])[0].options || [{}])[0].cost, 40);
  t('…the strip touched the ANSWER only: the merged item_data the route stored still carries the cost', /"cost":30/.test(String(WRITTEN && WRITTEN[1])), true);
  t('…and the stored stand-in row was not touched either', FAKE_ITEM.item_data.cost, 30);
  t('the owner’s own PATCH answer (above) still carries the cost', ownerPrice.body.item.item_data.cost, 30);

  const blindBoth = await call(port, 'PATCH', '/api/products/i1', { item_data: { status: 'unavailable', price: 1 } });
  t('status bundled WITH a blocked field still refuses the whole write, not a partial one', blindBoth.status, 403);

  WHO = STAFF_GRANTED; CAN_SEE_COSTS = { a2: true };
  const grantedPrice = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 80 } });
  t('once granted (on their OWN row), staff can change price like the owner can', grantedPrice.status, 200);

  /* T3-FIXES (CAT-FIX1): a parked change is the same write, so the same gate — refused before anything is read */
  WHO = STAFF_BLIND; CAN_SEE_COSTS = {};
  const blindSched = await call(port, 'POST', '/api/products/i1/schedule', { effective_at: '2030-01-01T00:00:00Z', item_data: { price: 80 } });
  t('cost-blind staff cannot SCHEDULE a price either — 403', blindSched.status, 403);
  t('…and the refusal carries its code, not only a sentence', blindSched.body.code, 'COST_BLIND');

  /* CAT-234: the parked list hands back each patch — the owner's parked cost never reaches a cost-blind reader */
  SCHED.pending = async () => [{ schedule_id: 's1', item_id: 'i1', effective_at: '2030-01-01T00:00:00Z', patch: { status: 'unavailable', cost: 30 } }];
  const blindList = await call(port, 'GET', '/api/products/i1/schedule');
  t('cost-blind staff read the parked list', blindList.status, 200);
  t('…without the owner’s parked cost, the rest of the patch kept', hasCostKey(blindList.body.pending) + ' ' + ((blindList.body.pending || [{}])[0].patch || {}).status, 'false unavailable');
  WHO = OWNER;
  const ownerList = await call(port, 'GET', '/api/products/i1/schedule');
  t('the owner reads the parked cost', ((ownerList.body.pending || [{}])[0].patch || {}).cost, 30);
  WHO = STAFF_BLIND;
  /* ⚠️ left as the case above left it: lib/cost holds THIS stub's withEntity (cached), so the next block reads these grants */
  CAN_SEE_COSTS = { a2: true };

  srv.close();
}

async function canSeeCostsReadCases() {
  console.log('\n-- [OFFR-04] GET /api/entities/me/can-see-costs — reads only, grants live in Co-assists ----\n');

  let WHO = OWNER;
  let CAN_SEE_COSTS = {};

  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
      entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
    }),
  };
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      query: async () => ({ rows: [] }),
      withEntity: async (_i, fn) => fn({
        query: async (sql, params) => {
          if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: !!CAN_SEE_COSTS[params[0]] }] };
          return { rows: [] };
        },
      }),
    },
  };

  delete require.cache[require.resolve(API + '/routes/entities')];
  const app = express();
  app.use(express.json());
  app.use('/api/entities', require(API + '/routes/entities'));
  const srv = app.listen(0);
  const port = srv.address().port;

  /* ⚠️⚠️⚠️ NO PATCH ROUTE HERE — the earlier version's own PATCH /me/offer-lab-costs is deleted, on
     purpose. There is exactly one way to grant this now: PATCH /api/actors/:id, tested in its own suite. */
  const patchAttempt = await call(port, 'PATCH', '/api/entities/me/can-see-costs', { visible_to_staff: true });
  t('there is no PATCH here at all — 404, not a second door to the same permission', patchAttempt.status, 404);

  WHO = OWNER;
  const ownerRead = await call(port, 'GET', '/api/entities/me/can-see-costs');
  t('the owner reads true, and is_owner true — the client shows nothing to grant, they already have it',
    ownerRead.body.can_see_costs + ' ' + ownerRead.body.is_owner, 'true true');

  WHO = STAFF_BLIND; CAN_SEE_COSTS = {};
  const blindRead = await call(port, 'GET', '/api/entities/me/can-see-costs');
  t('cost-blind staff reads false, and is_owner false', blindRead.body.can_see_costs + ' ' + blindRead.body.is_owner, 'false false');

  WHO = STAFF_GRANTED; CAN_SEE_COSTS = { a2: true };
  const grantedRead = await call(port, 'GET', '/api/entities/me/can-see-costs');
  t('once granted on the ACTOR’S OWN row, they read true', grantedRead.body.can_see_costs, true);

  srv.close();
}

(async () => {
  await productsCases();
  await canSeeCostsReadCases();
  console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
