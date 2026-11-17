'use strict';
/**
 * tests/network-offers-shape.test.cjs — GET /api/network-offers ANSWERS THE SAME SHAPE AFTER EFF-TRIPS (2026-10-15), IN ≤ 4 TRIPS.
 *
 * The route went from one read per part (9 trips on an empty store; 3 more per brand, 2 more per member) to three batched reads. This
 * freezes the ANSWER of the route BEFORE the change (tests/fixtures/network-offers-shape.golden.json, written by running the pre-change
 * handler against the same stubbed rows) and checks the route answers it, row for row, while a trip meter counts every db call.
 *
 * Two scenarios on one stubbed world: a STORE (adopts a brand's source, is in its network, one released offer, one price notice) and the
 * BRAND (authors a source, one member store, two offers). Rows are answered by SQL shape, so old and new statements meet the same facts.
 * Run: node tests/network-offers-shape.test.cjs [--write] · no DB, no network.
 *   (--write refreezes the golden from the CURRENT route — only after a deliberate shape change, said in the commit)
 */
const path = require('path');
const G = require('./support/route-golden.cjs');
const { S, B, rows, known } = require('./support/network-world.cjs');
const h = G.harness({ rows, known });
/* the trip meter — one per query, per transaction, per batch (what lib/trips counts) */
let trips = 0;
const q0 = h.db.query, we0 = h.db.withEntity, tx0 = h.db.withTransaction;
h.db.query = async (sql, params) => { trips++; return q0(sql, params); };
h.db.withEntity = async (id, fn) => { trips++; return we0(id, fn); };
h.db.withTransaction = async (fn) => { trips++; return tx0(fn); };
h.db.readBatch = async (id, actor, stmts) => { trips++; stmts.forEach((s) => require('../db').inlineSql ? null : null); return Promise.all(stmts.map((s) => q0(s.text, s.params))); };
const routeFile = process.env.NO_ROUTE_FILE || 'network-offers';   /* NO_ROUTE_FILE=_old-copy — how the golden was first frozen from the pre-change handler */
const app = h.app('/api/network-offers', require(path.join(G.API, 'routes', routeFile)));
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };
(async () => {
  const rec = {}, used = {};
  for (const [name, who] of [['store', S], ['brand', B]]) {
    trips = 0;
    const r = await h.run(app, { method: 'GET', url: '/api/network-offers', identity: { identity_id: who, identity_type: 'entity', entity_id: who } });
    rec[name] = { status: r.status, body: r.body }; used[name] = trips;
  }
  const fixture = path.join(__dirname, 'fixtures', 'network-offers-shape.golden.json');
  const bad = G.compare(rec, fixture);
  if (!process.argv.includes('--write')) {
    for (const name of Object.keys(rec)) {
      const b = bad.find((x) => x.name === name);
      t(name + ': the answer is the pre-change answer, row for row', !b, b ? G.firstDiff(b.got, b.want) : '');
      t(name + ': ≤ 4 trips', used[name] <= 4, used[name] + ' trips');
    }
    t('store: the released offer reaches the store with its choice', rec.store.body && rec.store.body.store.networks[0] && rec.store.body.store.networks[0].offers[0] && rec.store.body.store.networks[0].offers[0].choice === 'in');
    t('store: one price notice (yours 95, suggested 100)', rec.store.body && rec.store.body.store.price_notices.length === 1 && rec.store.body.store.price_notices[0].yours === 95);
    t('brand: a member by its account name, two offers, the catalogue half', rec.brand.body && rec.brand.body.brand.members[0].name === 'Shop One' && rec.brand.body.brand.offers.length === 2 && Array.isArray(rec.brand.body.brand.catalogue));
  }
  console.log(`\n  trips: store ${used.store} · brand ${used.brand}\n  ${pass} checks · ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
