/**
 * offr04-cost-gate.test.cjs — [OFFR-04] COST/MARGIN: OWNER ALWAYS, STAFF ONLY IF THE OWNER SAID SO.
 *
 * Athi: "the cost information... should not be visible for employee ie the cost information unless the
 * access is provided." Then, deciding the boundary: "employees should not see without a specific
 * permission. otherwise, leave it with owner only." Then: "decide the role boundary and build the gate...
 * Make cost visible for offer lab as a check box and it can be made visible otherwise they can only set
 * the availability flag, nothing else."
 *
 * ⚠️ NOT a unit test of access.canSeeCosts() alone — tests/iam-access.test.cjs already covers that
 * predicate in isolation. hat-gate.js's own history is the reason this one exists: a rule that only a unit
 * test has seen has not been proven wired to the real request path. This drives GET /api/products and
 * PATCH /api/products/:id, and the new PATCH/GET /api/entities/me/offer-lab-costs, through real express
 * with stubbed auth/db — no live database.
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
const STAFF_BLIND   = { identity_id: 'a1', identity_type: 'actor', identity_id_: 'a1', access_level: 'editor', parent_entity_id: 'e1', display_name: 'Blind Staff' };
const STAFF_GRANTED = { identity_id: 'a2', identity_type: 'actor', access_level: 'editor', parent_entity_id: 'e1', display_name: 'Granted Staff' };

const call = (port, method, path_, body) => new Promise((ok) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: path_, method,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(raw || '{}') })); });
  r.end(b);
});

async function productsCases() {
  console.log('\n-- [OFFR-04] GET/PATCH /api/products — cost stripped, availability-only PATCH for cost-blind staff --\n');

  let WHO = OWNER;
  let ENTITY_FLAGS = {};   // what entityPolicyFlags(entity_id) reads — the OWNER's own row, never the actor's
  let FLAGS_QUERY_THROWS = false;   // simulates a real production failure reading policy_flags
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
      /* entityPolicyFlags() reads policy_flags via query(); the merge-patch read in PATCH also uses withEntity */
      query: async (sql) => {
        if (/policy_flags FROM identities/.test(sql)) {
          if (FLAGS_QUERY_THROWS) throw new Error('simulated DB failure reading policy_flags');
          return { rows: [{ policy_flags: ENTITY_FLAGS }] };
        }
        return { rows: [] };
      },
      withEntity: async (_id, fn) => fn({
        query: async (sql) => {
          if (/SELECT item_data FROM catalogue_items/.test(sql)) return { rows: [{ item_data: Object.assign({}, FAKE_ITEM.item_data) }] };
          if (/UPDATE catalogue_items/.test(sql)) return { rows: [Object.assign({}, FAKE_ITEM)] };
          return { rows: [] };
        },
      }),
      readBatch: async (_entityId, _actorId, stmts) => {
        /* 4 statements when schedule is disabled: list, tally, categories, uncategorised */
        return [
          { rows: [Object.assign({}, FAKE_ITEM, { item_data: Object.assign({}, FAKE_ITEM.item_data) })] },
          { rows: [{ st: 'available' }] },
          { rows: [] },
          { rows: [{ n: 0 }] },
        ];
      },
    },
  };

  /* the route file caches `require('../lib/access')` and `require('../db')` at module load — force a fresh copy
     so it picks up the stubs above, not whatever an earlier test file in the same process already loaded */
  delete require.cache[require.resolve(API + '/routes/products')];
  const app = express();
  app.use(express.json());
  app.use('/api/products', require(API + '/routes/products'));
  const srv = app.listen(0);
  const port = srv.address().port;

  /* ── GET / — cost visible or stripped ── */
  WHO = OWNER;
  const asOwner = await call(port, 'GET', '/api/products');
  t('owner sees cost in the list', asOwner.body.items[0].item_data.cost, 30);

  WHO = STAFF_BLIND; ENTITY_FLAGS = {};
  const asBlind = await call(port, 'GET', '/api/products');
  t('cost-blind staff: cost is GONE from the response, not just hidden client-side',
    'cost' in (asBlind.body.items[0].item_data || {}), false);
  t('…and every other field is untouched', asBlind.body.items[0].item_data.price, 70);

  WHO = STAFF_GRANTED; ENTITY_FLAGS = { offer_lab_costs_visible_to_staff: true };
  const asGranted = await call(port, 'GET', '/api/products');
  t('once the OWNER turns the flag on, staff sees cost too', asGranted.body.items[0].item_data.cost, 30);

  /* ⚠️⚠️⚠️ THE FEATURE MUST NEVER BE ABLE TO BREAK THE CATALOGUE ITSELF — a real production edge case
     reading policy_flags (found live, 2026-09-25, the same day this shipped) must degrade, never 500 the
     whole list for everyone including the owner whose own numbers do not even depend on that read. */
  FLAGS_QUERY_THROWS = true;
  WHO = OWNER;
  const ownerDuringFailure = await call(port, 'GET', '/api/products');
  t('the policy_flags read failing does NOT 500 the owner’s own list', ownerDuringFailure.status, 200);
  t('…and the owner still sees their own cost — canSeeCosts(entity) never depended on that read anyway',
    ownerDuringFailure.body.items[0].item_data.cost, 30);

  WHO = STAFF_BLIND;
  const staffDuringFailure = await call(port, 'GET', '/api/products');
  t('and staff reading during the same failure gets a real list, not a 500', staffDuringFailure.status, 200);
  t('…failing to the SAFE side — cost hidden, same as if the flag had read false',
    'cost' in (staffDuringFailure.body.items[0].item_data || {}), false);

  const staffPatchDuringFailure = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 1 } });
  t('a write during the same failure also fails closed — refused, not silently allowed', staffPatchDuringFailure.status, 403);
  FLAGS_QUERY_THROWS = false;

  /* ── PATCH /:id — availability only for cost-blind staff ── */
  WHO = OWNER; ENTITY_FLAGS = {};
  const ownerPrice = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 80 } });
  t('the owner may change price', ownerPrice.status, 200);

  WHO = STAFF_BLIND; ENTITY_FLAGS = {};
  const blindPrice = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 80 } });
  t('cost-blind staff CANNOT change price — 403, not a silent 200', blindPrice.status, 403);
  t('…and the refusal names what is blocked, not a bare "Forbidden"', /price/.test(blindPrice.body.message), true);

  const blindCost = await call(port, 'PATCH', '/api/products/i1', { item_data: { cost: 20 } });
  t('cost-blind staff cannot set cost either — the field this whole feature protects', blindCost.status, 403);

  const blindStatus = await call(port, 'PATCH', '/api/products/i1', { item_data: { status: 'unavailable' } });
  t('cost-blind staff MAY flip availability — the one thing they are left with', blindStatus.status, 200);

  const blindBoth = await call(port, 'PATCH', '/api/products/i1', { item_data: { status: 'unavailable', price: 1 } });
  t('status bundled WITH a blocked field still refuses the whole write, not a partial one', blindBoth.status, 403);

  WHO = STAFF_GRANTED; ENTITY_FLAGS = { offer_lab_costs_visible_to_staff: true };
  const grantedPrice = await call(port, 'PATCH', '/api/products/i1', { item_data: { price: 80 } });
  t('once granted, staff can change price like the owner can', grantedPrice.status, 200);

  srv.close();
}

async function ownerOnlySwitchCases() {
  console.log('\n-- [OFFR-04] PATCH/GET /api/entities/me/offer-lab-costs — the checkbox is owner-only ----\n');

  let WHO = OWNER;
  let STORED = {};

  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
      entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
    }),
  };
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      query: async (sql, params) => {
        if (/UPDATE identities SET policy_flags/.test(sql)) { STORED.offer_lab_costs_visible_to_staff = params[0]; return { rows: [] }; }
        if (/policy_flags FROM identities/.test(sql)) return { rows: [{ policy_flags: STORED }] };
        return { rows: [] };
      },
      withEntity: async (_i, fn) => fn({ query: async () => ({ rows: [] }) }),
    },
  };

  delete require.cache[require.resolve(API + '/routes/entities')];
  const app = express();
  app.use(express.json());
  app.use('/api/entities', require(API + '/routes/entities'));
  const srv = app.listen(0);
  const port = srv.address().port;

  WHO = STAFF_BLIND;   // an EDITOR-level actor — hatGate alone would have let this actor's writes through
  const staffTry = await call(port, 'PATCH', '/api/entities/me/offer-lab-costs', { visible_to_staff: true });
  t('an editor-level co-assist CANNOT grant this to themselves', staffTry.status, 403);
  t('…and it says owner-only, not a generic refusal', /[Oo]wner/.test(staffTry.body.message), true);
  t('and nothing was actually stored by the attempt', STORED.offer_lab_costs_visible_to_staff, undefined);

  WHO = OWNER;
  const ownerSet = await call(port, 'PATCH', '/api/entities/me/offer-lab-costs', { visible_to_staff: true });
  t('the owner CAN turn it on', ownerSet.status, 200);

  const read = await call(port, 'GET', '/api/entities/me/offer-lab-costs');
  t('reading it back confirms what was just set', read.body.visible_to_staff, true);
  t('and says the owner IS the owner — so the client shows the checkbox', read.body.is_owner, true);

  WHO = STAFF_GRANTED;
  const readAsStaff = await call(port, 'GET', '/api/entities/me/offer-lab-costs');
  t('staff reading it back sees is_owner:false — the client hides the checkbox from them entirely', readAsStaff.body.is_owner, false);
  t('…and sees their own resolved permission, not just the raw flag', readAsStaff.body.can_see_costs, true);

  srv.close();
}

(async () => {
  await productsCases();
  await ownerOnlySwitchCases();
  console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
