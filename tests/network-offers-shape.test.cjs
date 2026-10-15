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
const S = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', O = '00000000-0000-4000-8000-00000000000c', O2 = '00000000-0000-4000-8000-00000000000d';
const AT = '2026-10-01T00:00:00.000Z';
const flagsB = { network_offers: { policy: 'opt_out', released: { [O]: { version: 1, at: AT, until: null, released_at: AT } } },
  network_catalogue: { pending: {}, withdrawn_at: {}, log: [{ id: 'L1', source_key: 'src1', applied_at: AT, changes: [{ name: 'Tea', kind: 'changed', fields: [{ field: 'price', from: 90, to: 100 }] }] }] } };
const flagsS = { network_choices: { [O]: 'in' }, network_price_seen: {} };
const items = [{ name: 'Tea', price: 100, mrp: 110 }];
const first = (params) => String((params || [])[0] || '');
const rows = (sql, params) => {
  if (/FROM identities WHERE identity_id = ANY/.test(sql)) return [S, B].filter((id) => (params[0] || []).includes(id)).map((id) => ({ id, display_name: id === S ? 'Shop One' : 'Brand Handle', policy_flags: id === S ? flagsS : flagsB }));
  if (/^SELECT display_name(, gstn)?.* FROM identities WHERE identity_id = \$1/.test(sql)) return [{ display_name: first(params) === S ? 'Shop One' : 'Brand Handle', policy_flags: first(params) === S ? flagsS : flagsB, country: 'IN' }];
  if (/FROM entity_profile/.test(sql)) return [];
  if (/FROM definition/.test(sql) && /status IN \('live', 'draft'\)/.test(sql)) return first(params) === B ? [{ definition_id: O, name: 'Tea Tuesday', sub_kind: 'discount', status: 'live', current_version: 1 }, { definition_id: O2, name: 'Winter', sub_kind: 'combo', status: 'draft', current_version: 2 }] : [];
  if (/FROM definition/.test(sql) && /definition_id::text = ANY/.test(sql)) return first(params) === B ? [{ definition_id: O, name: 'Tea Tuesday', sub_kind: 'discount', status: 'live' }] : [];
  if (/AS owns/.test(sql)) return first(params) === B ? [{ owns: true, node: 'n-b', bridge_id: 'brand.cb', root_bridge_id: 'brand.cb' }] : [{ owns: false, node: 'n-s', bridge_id: 'shop.cb', root_bridge_id: 'brand.cb' }];
  if (/'built' AS via/.test(sql)) return first(params) === B ? [{ id: S, via: 'joined', state: 'active', edge_id: 'e1', asked_by: 'store', node_id: 'n-s', parent_node: 'n-b' }] : [];
  if (/FROM catalogue_adoption a LEFT JOIN catalogue_source s/.test(sql)) return first(params) === S ? [{ source_key: 'src1', commercials: { Tea: { price: 95 } }, owner_entity_id: B, items }] : [];
  if (/^SELECT source_key, commercials FROM catalogue_adoption/.test(sql)) return first(params) === S ? [{ source_key: 'src1', commercials: { Tea: { price: 95 } } }] : [];
  if (/^SELECT source_key, owner_entity_id(, items)? FROM catalogue_source WHERE source_key = ANY/.test(sql)) return [{ source_key: 'src1', owner_entity_id: B, items }];
  if (/AS brand_id/.test(sql) && /cb_edge e ON e.child_id/.test(sql)) return first(params) === S ? [{ brand_id: B }] : [];
  if (/AS tree_parent/.test(sql)) return [{ brand_id: B, brand_node: 'n-b', store_node: 'n-s', brand_bridge_id: 'brand.cb', root_bridge_id: 'brand.cb', tree_parent: null, built: false, tree_state: null, tree_edge: null, edge_id: 'e1', edge_state: 'active', asked_by: 'store' }];
  if (/^SELECT title FROM catalogue_source WHERE owner_entity_id/.test(sql)) return [{ title: 'Brand Co' }];
  if (/DISTINCT ON \(owner_entity_id\)/.test(sql)) return [{ id: B, title: 'Brand Co' }];
  if (/^SELECT b FROM unnest/.test(sql)) return [{ b: B }];
  if (/^SELECT source_key, title, items FROM catalogue_source WHERE owner_entity_id/.test(sql)) return first(params) === B ? [{ source_key: 'src1', title: 'Brand Co', items }] : [];
  if (/FROM catalogue_items/.test(sql)) return first(params) === B ? [{ item_id: 'i1', item_data: { name: 'Tea', price: 100, mrp: 110 } }] : [];
  return [];
};
const h = G.harness({ rows, known: { [S]: 'STORE', [B]: 'BRAND', [O]: 'OFFER', [O2]: 'OFFER2' } });
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
