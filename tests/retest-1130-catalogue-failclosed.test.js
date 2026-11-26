'use strict';
// @type: unit
/**
 * retest-1130-catalogue-failclosed.test.js — CARD qa/offline-guards (retest 1130, lane retest1129b): the three landed P1 catalogue fixes of reviews3 (cc93d7484) that no test named.
 *
 * OWNS      EL-catalogue-01#L53  the visibility gate read FAILS CLOSED: a timeout or any fault answers 'private'; only "the b114 column is missing" (42703) keeps the open answer
 *           EL-catalogue-01#L62  loadSource's narrow read runs only for a missing column; any other fault answers nothing (the brand's item list never reaches a non-member)
 *           GF-catalogue-01#L48  a failed exposure.apply falls to dropCostRegardless: cost stays off the item AND off lines[].fields
 * CALLED BY scripts/guards-list-3.cjs (scripts/guards.cjs) · CI. No database, no network: ../db is stubbed like tests/rev04-cost-leak.test.js.
 * FLOW      stub db → the real catalogue-view / catalogue-build → asserts. Break check: run with lib/catalogue-view.js and lib/catalogue-build.js of cc93d7484^ and cases fail.
 */
const assert = require('node:assert');
let bound, mode = 'ok', calls = [];
const dbPath = require.resolve('../db');
const stubQuery = async (sql) => {
  calls.push(String(sql).slice(0, 30));
  if (mode === 'timeout') { const e = new Error('canceling statement due to statement timeout'); e.code = '57014'; throw e; }
  if (mode === 'column') { if (/s\.owner_entity_id/.test(sql)) { const e = new Error('column "owner_entity_id" does not exist'); e.code = '42703'; throw e; } return { rows: [{ source_key: 'k1', version: 1, for_vertical: 'v', title: 'Brand', collection: 'C', schema: [], items: [{ name: 'Brand item', combinations: [] }], commercials_fields: null }] }; }
  return { rows: [] };
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { queryFor: (id) => bound.queryFor(id), queryAs: (id, s, p) => bound.queryAs(id, s, p), query: stubQuery, pool: {} } };
const view = require('../lib/catalogue-view');
const build = require('../lib/catalogue-build');
const { boundDb, schemaRows } = require('./support/bound-db.cjs');
const catalogueRead = require('../lib/catalogue-read');
const orderInput = require('../lib/order-input');
const CASES = []; const t = (n, f) => CASES.push([n, f]);

/* EL-catalogue-01#L53 */
const gate = (query) => view.catalogueVisibility({ entity_id: 'e1', query, visibilityCap: null, viewer: null });
t('EL-catalogue-01#L53 a timeout on the gate read answers private (closed), never the open answer', async () => {
  const e = new Error('statement timeout'); e.code = '57014';
  assert.strictEqual(await gate(async () => { throw e; }), 'private');
  assert.strictEqual(await gate(async () => { throw new Error('connection reset'); }), 'private');
});
t('EL-catalogue-01#L53 only a missing b114 column keeps the old open answer (null); a missing identity row is null', async () => {
  const c = new Error('x'); c.code = '42703';
  assert.strictEqual(await gate(async () => { throw c; }), null);
  assert.strictEqual(await gate(async () => { throw new Error('column catalogue_visibility does not exist'); }), null);
  assert.strictEqual(await gate(async () => ({ rows: [] })), null);
});
t('EL-catalogue-01#L53 control: a public shop reads public', async () => {
  assert.strictEqual(await gate(async () => ({ rows: [{ catalogue_visibility: 'public', plan: 'free', params_override: null, bridge_id: 'CB1', business_status: 'open' }] })), 'public');
});

/* EL-catalogue-01#L62 */
t('EL-catalogue-01#L62 a timeout on the source read answers nothing and runs NO narrow fallback read', async () => {
  mode = 'timeout'; calls = [];
  const proposal = await build.build('brand_not_in_code', 'viewer-entity');
  assert.strictEqual(proposal, null, 'a faulted read must not hand out the brand item list');
  assert.strictEqual(calls.length, 1, 'the narrow base-columns read must not run for a timeout, calls: ' + calls.join('|'));
});
t('EL-catalogue-01#L62 a missing column still takes the narrow read (the pre-b78 database keeps working)', async () => {
  mode = 'column'; calls = [];
  const proposal = await build.build('brand_not_in_code', 'viewer-entity');
  assert.ok(proposal && calls.length === 2, 'narrow read expected, calls: ' + calls.join('|') + ' proposal ' + !!proposal);
});

/* GF-catalogue-01#L48 */
const ENTITY = { identity_id: 'e1', bridge_id: 'CBTEST0001', display_name: 'Test Store' };
const ITEM_ROW = { item_id: 'i1', created_at: '2026-09-01T00:00:00Z', item_data: { name: 'Widget', price: 500, cost: { value: 380, source: 'manual', at: '2026-09-01' }, unit_cost: 380 } };
function deps() {
  const query = async (sql) => {
    if (/catalogue_visibility/.test(sql)) return { rows: [{ catalogue_visibility: 'public' }] };
    if (/FROM entity_schemas/.test(sql)) return { rows: [{ schema_id: 's1', schema_name: 'Products' }] };
    if (/storefront_access, policy_flags FROM identities/.test(sql)) return { rows: [{ storefront_access: 'browse', policy_flags: {} }] };
    return { rows: [] };
  };
  const withEntity = async (_e, fn) => fn({ query: async (sql) => (/FROM catalogue_items/.test(sql) ? { rows: [JSON.parse(JSON.stringify(ITEM_ROW))] } : { rows: [] }) });
  const catalogueBuild = { resolve: async (key) => ({ title: 'Templates', collection: 'T', items: [], source_key: key }) };
  bound = boundDb(schemaRows({ e1: { schema_id: 's1', schema_name: 'Products', fields: [] } }));
  return { entity: ENTITY, query, withEntity, catalogueBuild, orderInput, catalogueRead };
}
t('GF-catalogue-01#L48 exposure.apply throwing still leaves cost off the item and off lines[].fields', async () => {
  const exposure = require('../lib/exposure'); const real = exposure.apply;
  exposure.apply = () => { throw new Error('exposure switch read failed'); };
  try {
    const v = await view.buildPublicView(deps());
    assert.strictEqual(v.items.length, 1);
    assert.strictEqual(v.items[0].item_data.cost, undefined, 'item cost survived a failed exposure.apply');
    assert.strictEqual(v.items[0].item_data.unit_cost, undefined, 'unit_cost survived');
    const line = v.lines.find((l) => l.item_id === 'i1');
    assert.ok(line, 'no line built');
    assert.strictEqual(line.fields.cost, undefined, 'cost leaked into lines[].fields');
    assert.ok(!JSON.stringify(v).includes('380'), 'the cost figure 380 is in the public answer');
    assert.strictEqual(line.fields.price, 500);
  } finally { exposure.apply = real; }
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of CASES) { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' - ' + (e && e.message)); } }
  console.log(pass + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})();
