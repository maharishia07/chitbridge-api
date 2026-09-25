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
  const FAKE_ITEM = { item_id: 'i1', item_data: { name: 'Masala Dosa', price: 70, cost: 30, status: 'available' } };

  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
      entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
    }),
  };
  require.cache[require.resolve(API + '/lib/schedule')] = {
    exports: { enabled: async () => false, TABLE: 'x', pending: async () => [], applyDue: async () => {} },
  };
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      query: async () => ({ rows: [] }),
      /* lib/cost.js's canRead() reads can_see_costs through withEntity; the merge-patch read in PATCH
         also uses withEntity — both share this one stub */
      withEntity: async (_id, fn) => fn({
        query: async (sql, params) => {
          if (/can_see_costs FROM identities/.test(sql)) {
            if (FLAGS_QUERY_THROWS) throw new Error('simulated DB failure reading can_see_costs');
            return { rows: [{ can_see_costs: !!CAN_SEE_COSTS[params[0]] }] };
          }
          if (/SELECT item_data FROM catalogue_items/.test(sql)) return { rows: [{ item_data: Object.assign({}, FAKE_ITEM.item_data) }] };
          if (/UPDATE catalogue_items/.test(sql)) return { rows: [Object.assign({}, FAKE_ITEM)] };
          return { rows: [] };
        },
      }),
      readBatch: async () => ([
        { rows: [Object.assign({}, FAKE_ITEM, { item_data: Object.assign({}, FAKE_ITEM.item_data) })] },
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
  const ownerPrice = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 80 } });
  t('the owner may change price', ownerPrice.status, 200);

  WHO = STAFF_BLIND;
  const blindPrice = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 80 } });
  t('cost-blind staff CANNOT change price — 403, not a silent 200', blindPrice.status, 403);
  t('…and the refusal points at Co-assists, the real place this is granted',
    /Co-assists/.test(blindPrice.body.message), true);

  const blindCost = await call(port, 'PATCH', '/api/products/i1', { item_data: { cost: 20 } });
  t('cost-blind staff cannot set cost either — the field this whole feature protects', blindCost.status, 403);

  const blindStatus = await call(port, 'PATCH', '/api/products/i1', { item_data: { status: 'unavailable' } });
  t('cost-blind staff MAY flip availability — the one thing they are left with', blindStatus.status, 200);

  const blindBoth = await call(port, 'PATCH', '/api/products/i1', { item_data: { status: 'unavailable', price: 1 } });
  t('status bundled WITH a blocked field still refuses the whole write, not a partial one', blindBoth.status, 403);

  WHO = STAFF_GRANTED; CAN_SEE_COSTS = { a2: true };
  const grantedPrice = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 80 } });
  t('once granted (on their OWN row), staff can change price like the owner can', grantedPrice.status, 200);

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
