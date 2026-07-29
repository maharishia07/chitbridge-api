'use strict';
// Regression — CATALOGUE VISIBILITY (b114).
//
// Athi's access model: a public catalogue is open to the world — the visitor may be a person, another store, or a
// network peer, and the requester's TYPE is irrelevant; only the OWNER's setting is. A private entity is closed to
// all of them.
//
// The defect: availability was `hasSchema || finishes.length`, so ADOPTING a catalogue silently PUBLISHED your
// storefront. Proven live before the fix — a store with schema:null and items:0 served 2 templates to the internet.
//
// No DB needed: buildPublicView takes its dependencies by injection, so we drive it with fakes.
// Run:  node tests/catalogue-visibility.test.js
const assert = require('node:assert');
const view = require('../lib/catalogue-view');
const orderInput = require('../lib/order-input');

let pass = 0, fail = 0;
const CASES = [];
const t = (name, fn) => CASES.push([name, fn]);   // collected, then run sequentially so the output is ordered

const ENTITY = { identity_id: 'e1', bridge_id: 'CBTEST0001', display_name: 'Test Store' };

// A fake DB. `visibility` may be 'public' | 'private' | MISSING (simulating b114 not applied, which must throw).
function deps({ visibility, hasSchema = false, adoptions = [] }) {
  const query = async (sql) => {
    if (/catalogue_visibility/.test(sql)) {
      if (visibility === undefined) throw new Error('column "catalogue_visibility" does not exist');
      return { rows: [{ catalogue_visibility: visibility }] };
    }
    if (/FROM entity_schemas/.test(sql)) return { rows: hasSchema ? [{ schema_id: 's1', schema_name: 'Products' }] : [] };
    if (/FROM schema_fields/.test(sql)) return { rows: [] };
    if (/storefront_access/.test(sql)) return { rows: [{ storefront_access: 'browse' }] };
    return { rows: [] };
  };
  const withEntity = async (_e, fn) => fn({ query: async (sql) => {
    if (/catalogue_adoption/.test(sql)) return { rows: adoptions };
    if (/catalogue_items/.test(sql)) return { rows: [] };
    if (/catalogue_face/.test(sql)) return { rows: [] };
    return { rows: [] };
  } });
  const catalogueBuild = { resolve: async (key) => ({ title: 'Templates', collection: 'T', items: [{ name: 'ITR-2' }] , source_key: key }) };
  return { entity: ENTITY, query, withEntity, catalogueBuild, orderInput };
}

// ── the defect this fixes ──
t('BEFORE-STYLE: adopting a catalogue with no public schema WOULD publish (pre-b114 behaviour is preserved when the column is absent)', async () => {
  const v = await view.buildPublicView(deps({ visibility: undefined, hasSchema: false, adoptions: [{ source_key: 'x@v1', commercials: {} }] }));
  assert.strictEqual(v.available, true, 'self-healing: without b114 the old behaviour must be identical');
  assert.strictEqual(v.schema, null);
  assert.strictEqual(v.finishes.length, 1, 'published purely by adopting — the defect, kept only until b114 is applied');
});
t('AFTER: private closes it, even though an adoption exists', async () => {
  const v = await view.buildPublicView(deps({ visibility: 'private', hasSchema: false, adoptions: [{ source_key: 'x@v1', commercials: {} }] }));
  assert.strictEqual(v.available, false);
  assert.strictEqual(v.reason, 'private');
});
t('AFTER: private closes it even with a public schema — the OWNER decides, nothing else', async () => {
  const v = await view.buildPublicView(deps({ visibility: 'private', hasSchema: true }));
  assert.strictEqual(v.available, false);
});
t('AFTER: public serves exactly as before', async () => {
  const v = await view.buildPublicView(deps({ visibility: 'public', hasSchema: false, adoptions: [{ source_key: 'x@v1', commercials: {} }] }));
  assert.strictEqual(v.available, true);
  assert.strictEqual(v.finishes.length, 1);
  assert.strictEqual(v.shop.bridge_id, 'CBTEST0001');
});

// ── the requester's type is irrelevant — one setting governs every principal ──
t('the SAME resolver answers for every principal, so private is private to all of them', async () => {
  const priv = deps({ visibility: 'private', hasSchema: true, adoptions: [{ source_key: 'x@v1', commercials: {} }] });
  // storefront (anonymous), supplier (entity), network peer — all call this one function
  for (const _principal of ['anonymous', 'supplier-entity', 'network-peer']) {
    const v = await view.buildPublicView(priv);
    assert.strictEqual(v.available, false, 'closed for ' + _principal);
  }
});

// ── a private catalogue must not leak its existence through the shape of the answer ──
t('private reveals NOTHING — no schema, no counts, same shape as "nothing published"', async () => {
  const v = await view.buildPublicView(deps({ visibility: 'private', hasSchema: true, adoptions: [{ source_key: 'x@v1', commercials: {} }] }));
  assert.deepStrictEqual(Object.keys(v).sort(), ['available', 'reason']);
  assert.strictEqual(v.shop, undefined);
  assert.strictEqual(v.items, undefined);
  assert.strictEqual(v.finishes, undefined);
});
t('private short-circuits BEFORE any catalogue query runs (no work, no timing signal)', async () => {
  let touched = 0;
  const d = deps({ visibility: 'private', hasSchema: true, adoptions: [{ source_key: 'x@v1', commercials: {} }] });
  const q = d.query;
  d.query = async (sql) => { if (!/catalogue_visibility/.test(sql)) touched++; return q(sql); };
  d.withEntity = async () => { touched++; return { rows: [] }; };
  await view.buildPublicView(d);
  assert.strictEqual(touched, 0, 'a private catalogue must cost nothing to refuse');
});

// ── an unrecognised value must not be treated as public ──
t('an unknown visibility value falls back to pre-b114 behaviour, never to "trust the string"', async () => {
  const v = await view.buildPublicView(deps({ visibility: 'weird', hasSchema: true }));
  assert.strictEqual(v.available, true, 'unrecognised → null → pre-b114 path (the CHECK constraint is the real guard)');
});

(async () => {
  for (const [name, fn] of CASES) {
    try { await fn(); console.log('\x1b[32mok\x1b[0m  ' + name); pass++; }
    catch (e) { console.log('\x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
