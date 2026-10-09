'use strict';
/**
 * sides.test.cjs — CB Sides: GET /api/entities/sides and the two engines it stands on.
 *  - governance/resolver.driftOf: minted vs active, built on driftStatus; an unrecorded side is "unknown", never "no drift"
 *  - lib/impact: ONE walk (raida.walk uses it too) + reach(): "N businesses · M filings", filings null when nothing can say
 *  - lib/sides.build: the constitution row drifts -> "Update" + Review; a brand source drifts the same way; boilerplate / blueprint /
 *    jurisdiction / standards / filings / inherit are "not yet" rows (s:'later'), never a number; trade proof is the header's 3 of 4 + Finish
 *  - the route: one readBatch, 1 warm trip of its own (the two reuses are stubbed), a failed reuse -> rows say "not yet", not a 500
 * Run: node tests/sides.test.cjs   · no DB, no network.   (NODE_PATH must reach the api's node_modules)
 */
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name + (extra ? '   ' + extra : '')); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── driftOf ── */
const { driftOf, driftStatus } = require(path.join(API, 'governance', 'resolver'));
t('driftOf: older minted -> drift', eq(driftOf('0.1', '0.2'), { minted: '0.1', active: '0.2', known: true, drift: true }));
t('driftOf: same -> no drift', eq(driftOf('0.2', '0.2'), { minted: '0.2', active: '0.2', known: true, drift: false }));
t('driftOf: numbers and strings compare as text, like driftStatus', driftOf(2, '2').drift === false && driftStatus(2, '2') === false);
t('driftOf: minted unrecorded -> unknown, drift null (never "Current")', eq(driftOf(null, '0.2'), { minted: null, active: '0.2', known: false, drift: null }));
t('driftOf: active unrecorded or blank -> unknown', driftOf('0.2', undefined).known === false && driftOf('0.2', '  ').drift === null);
t('driftStatus is still exported and unchanged', driftStatus('0.1', '0.2') === true && driftStatus('0.2', '0.2') === false);

/* ── impact ── */
const impact = require(path.join(API, 'lib', 'impact'));
const E = (id, line, to, type, label) => ({ raida_id: id, kind: 'dependency', body: 'b' + id, line_id: line, subject_id: null, rel_type: 'finish_to_start', to_type: type, to_id: to, to_label: label, severity: 2 });
const edges = [E('r1', 'A', 'B', 'line'), E('r2', 'B', 'C', 'line'), E('r3', 'C', 'A', 'line') /* a cycle */, E('r4', 'X', 'ME', 'entity', 'Asha Traders'), E('r5', 'Y', 'ME', 'filing', 'GSTR-1')];
const fwd = impact.walk(edges, 'A', { backwards: false });
t('walk: forward from A reaches what waits on it and stops at the cycle', fwd.hops.map((h) => h.raida_id).join() === 'r3,r2,r1', fwd.hops.map((h) => h.raida_id).join());
t('walk: backwards follows what A waits on', impact.walk(edges, 'A', { backwards: true }).hops[0].raida_id === 'r1');
t('walk: depth is bounded', impact.walk(edges, 'A', { depth: 1 }).hops.length === 1);
t('walk: shape matches what raida.walk always returned', ['hops', 'depth_reached', 'truncated', 'backwards'].every((k) => k in fwd));
const reach = impact.reach(impact.walk(edges, 'ME').hops, [{ id: 'p1' }, { id: 'p2' }, { id: 'p1' }]);
t('reach: distinct partners + hops that point at a business', reach.businesses === 3 && reach.ids.includes('ME'), JSON.stringify(reach));
t('reach: a filing hop is counted', reach.filings === 1);
t('reach: nothing can say about filings -> null, not 0', impact.reach([], [{ id: 'p1' }]).filings === null);

/* ── build (pure) ── */
const sides = require(path.join(API, 'lib', 'sides'));
const rowOf = (side, key, id) => side.find((g) => g.key === key).rows.find((r) => r.id === id);
const rows = {
  me: [{ display_name: 'Mayur Bhavan', country: 'IN', gstn: '33ABCDE1234F1Z5' }],
  gov: [{ constitution_key: 'hotel', minted: '0.1', active: '0.2', boilerplate_key: 'hotel-bp', boilerplate_version: null, blueprint_key: null, blueprint_version: null }],
  adopt: [{ source_key: 'hotel-starter', minted: 'v5', active: 'v5', title: 'Hotel starter catalogue' }, { source_key: 'feed', minted: 'v8', active: 'v9', title: 'Feed' }],
  conn: [{ connector_type: 'tally', ref: 'x', enabled: true, status: 'green' }],
  actors: [{ display_name: 'Bala', actor_role: 'accountant', can_see_costs: false }, { display_name: 'Ravi', actor_role: 'x', can_see_costs: true }],
  customers: [{ id: 'c1', name: 'Asha Stores' }, { id: 'c2', name: 'Pooja Mart' }],
  suppliers: [{ id: 's1', name: 'Fresh Farm' }],
  bp: [{ version: '3', label: 'Hotel' }],
  edges,
};
const header = { trade_ready: { checks: [{ key: 'address', label: 'Address proven', done: true }, { key: 'phone', label: 'Phone verified', done: true }, { key: 'pan', label: 'PAN on file', done: true }, { key: 'gstin', label: 'GSTIN', done: false }] } };
const rail = { suppliers: 3, customers: 2, in: 24, out: 5 };
const B = (o) => sides.build(Object.assign({ gov: rows.gov[0], rail, header, entity_id: 'ME' }, o, { rows: Object.assign({}, rows, (o && o.rows) || {}) }));
const b = B();
const con = rowOf(b.lean, 'rules', 'constitution');
t('constitution drift: "Update" + Review, with the two versions in the detail', con.s === 'wait' && con.t === 'Update' && con.fix === 'Review' && /v0\.1/.test(con.detail) && /v0\.2/.test(con.detail), JSON.stringify(con));
t('a current brand source says Current, a drifted one says Update + Review', rowOf(b.lean, 'content', 'src:hotel-starter').s === 'ok' && rowOf(b.lean, 'content', 'src:feed').fix === 'Review');
t('boilerplate with no version at mint is "not yet", not "Current"', rowOf(b.lean, 'mould', 'boilerplate').s === 'later' && rowOf(b.lean, 'mould', 'boilerplate').t === 'not yet');
t('blueprint not recorded -> "not yet"', rowOf(b.lean, 'mould', 'blueprint').s === 'later');
t('jurisdiction and standards are "not yet" rows (nothing stamps their version)', rowOf(b.lean, 'rules', 'jurisdiction').s === 'later' && rowOf(b.lean, 'rules', 'standards').s === 'later');
t('jurisdiction names the country', rowOf(b.lean, 'rules', 'jurisdiction').n === 'India');
t('a connector is Linked; suppliers are the rail count', rowOf(b.lean, 'systems', 'conn:0').t === 'Linked' && rowOf(b.lean, 'buy', 'suppliers').n === '3 suppliers');
t('boilerplate drift shows once the mint version exists', B({ gov: Object.assign({}, rows.gov[0], { boilerplate_version: '2' }) }).lean[1].rows[0].fix === 'Review');
t('trade: customers carry open chits, suppliers carry open orders', rowOf(b.use, 'trade', 'customers').m === '24 chits open' && rowOf(b.use, 'trade', 'suppliers-out').m === '5 orders open');
t('co-assists: what each sees', rowOf(b.use, 'act', 'actor:0').m === 'Co-assist · no costs' && rowOf(b.use, 'act', 'actor:1').m === 'Co-assist · sees costs');
const pr = rowOf(b.use, 'cite', 'proof');
t('trade proof is the header 3 of 4, with Finish and what is missing', pr.m === '3 of 4 shown' && pr.fix === 'Finish' && pr.t === 'GSTIN' && !!pr.href, JSON.stringify(pr));
t('filings and inheriting shops are "not yet" rows, not numbers', rowOf(b.use, 'cite', 'filings').s === 'later' && rowOf(b.use, 'inherit', 'inherit').s === 'later');
t('impact: businesses = partners + register hops; filings from the hop', b.impact.businesses === 4 && b.impact.filings === 1 && /4 businesses · 1 filing/.test(b.impact.m), JSON.stringify(b.impact));
t('impact: who lists names', b.impact.who.length >= 3 && b.impact.who.some((w) => w.name === 'Asha Stores'));
const noEdges = B({ rows: { edges: [] } });
t('impact: no filing source -> "filings not yet", never 0', noEdges.impact.filings === null && /filings not yet/.test(noEdges.impact.m), noEdges.impact.m);
const none = sides.build({ rows: { me: [{ country: 'IN' }], customers: [], suppliers: [], actors: [] }, gov: null, rail: { suppliers: 0, customers: 0, in: 0, out: 0 }, header: null, entity_id: 'ME' });
t('a new business: no stamp row says so; empty groups are placeholders; impact says nobody', rowOf(none.lean, 'rules', 'constitution').s === 'later' && rowOf(none.use, 'trade', 'nobody').s === 'empty' && rowOf(none.use, 'act', 'noactor').s === 'empty' && none.impact.m === 'Nobody affected');
t('header unreadable -> trade proof is a "not yet" row', rowOf(none.use, 'cite', 'proof').s === 'later');
const dead = sides.build({ rows: { me: [{}], customers: [], suppliers: [], actors: [] }, gov: null, rail: null, header: null, entity_id: 'ME' });
t('rail unreadable -> trade is one "not yet" row (no 0)', rowOf(dead.use, 'trade', 'trade').s === 'later');

/* ── the route ── */
let trips = 0, sent = [];
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);
const present = (sql, params) => /FROM constitution/.test(sql) ? [{ constitution_key: 'hotel', version: '0.2' }] : /information_schema\.columns/.test(sql) ? (params[1] || []).map((c) => ({ column_name: c })) : /information_schema\.tables/.test(sql) ? [{ '?column?': 1 }] : [];
const rowsFor = (s) => {
  if (/FROM identities WHERE identity_id/.test(s)) return rows.me;
  if (/FROM boilerplate/.test(s)) return rows.bp;
  if (/FROM entity_governance/.test(s)) return rows.gov;
  if (/FROM catalogue_adoption/.test(s)) return rows.adopt;
  if (/FROM connector_connection/.test(s)) return rows.conn;
  if (/FROM identities WHERE parent_entity_id/.test(s)) return rows.actors;
  if (/FROM customer_list/.test(s)) return rows.customers;
  if (/FROM supplier_list/.test(s)) return rows.suppliers;
  if (/FROM register_entry/.test(s)) return rows.edges;
  return [];
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql, params) => { trips += 1; const r = present(String(sql), params || []); return { rows: r, rowCount: r.length }; },
  readBatch: async (id, actor, stmts) => { trips += 1; return stmts.map((s) => { realDb.inlineSql(s.text, s.params); sent.push(s.text); return { rows: rowsFor(s.text) }; }); },
}) };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'ME', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (r) => r.identity, forgetKey: () => {}, keyAlive: async () => true }) };
const HF = require(path.join(API, 'lib', 'home-facts')), EH = require(path.join(API, 'lib', 'entity-header'));
let railMode = 'ok';
HF.BUILD.rail = async () => { if (railMode === 'boom') throw new Error('x'); return rail; };
EH.read = async () => header;

const express = require('express');
const app = express();
app.use('/api/entities', require(path.join(API, 'routes', 'entities')));
const srv = app.listen(0, '127.0.0.1', async () => {
  try {
    const get = async () => { trips = 0; sent = []; const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/entities/sides`); const j = await r.json(); return { status: r.status, j, trips }; };
    const cold = await get();
    t('route: 200 with lean, use, impact', cold.status === 200 && Array.isArray(cold.j.lean) && Array.isArray(cold.j.use) && cold.j.impact, String(cold.status));
    t('route: the constitution drift survives the wire (stamp from govresolve.mintedOf, active from the constitution cache)', cold.j.lean[0].rows.some((r) => r.id === 'constitution' && r.fix === 'Review'));
    const warm = await get();
    t('route: a warm read is TWO trips of its own - the batch and the stamp (govresolve.mintedOf); rail + header are the reuses, stubbed here', warm.trips === 2, warm.trips + ' used');
    t('route: every statement is a SELECT (reads only)', sent.length > 0 && sent.every((s) => /^\s*SELECT/i.test(s)));
    t('route: a missing table is probed, not queried (no SAVEPOINT)', !sent.some((s) => /SAVEPOINT/i.test(s)));
    railMode = 'boom'; const dead2 = await get();
    t('route: rail failing -> 200, the trade row says "not yet"', dead2.status === 200 && dead2.j.use[0].rows[0].s === 'later');
  } catch (e) { fail++; console.log('  FAIL threw', e && e.stack); }
  console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n  ' + (pass + fail) + ' checks');
  process.exitCode = fail ? 1 : 0;
  srv.close();
});
