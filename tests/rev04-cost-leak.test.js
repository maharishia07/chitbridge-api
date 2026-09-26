'use strict';
// rev04-cost-leak.test.js — [REV-04] "cost price reaches the anonymous storefront" (external code review,
// 2026-09-25, §4, stop-the-release).
//
// catalogueRead.lines()'s ownedLine() copies EVERY key of item_data — cost included — into line.fields, by
// value, the moment it runs. exposure.apply() used to strip cost from `items` itself much later in
// buildPublicView() — clearing item_data.cost on the ORIGINAL item, but allLines' own copy had already been
// taken, cost and all. tests/exposure-cost.test.js passed throughout because it asserts on exposure.apply()
// in isolation and never on what buildPublicView() actually returns — this is the review's own point: "the
// gap is exactly between the module and the response." So THIS drives the real buildPublicView(), with a
// real catalogueRead, exactly the way routes/catalogue.js's publicViewFor() does — the actual route payload,
// not the module in isolation.
//
// No DB needed: buildPublicView takes its dependencies by injection — same harness shape as
// tests/catalogue-visibility.test.js, extended with a real owned item (cost included) and a real
// catalogueRead module.
// Run: node tests/rev04-cost-leak.test.js
const assert = require('node:assert');
const view = require('../lib/catalogue-view');
const catalogueRead = require('../lib/catalogue-read');
const orderInput = require('../lib/order-input');

let pass = 0, fail = 0;
const CASES = [];
const t = (name, fn) => CASES.push([name, fn]);

const ENTITY = { identity_id: 'e1', bridge_id: 'CBTEST0001', display_name: 'Test Store' };
const ITEM_ID = 'i1';
/* ⭐ THE EXACT SHAPE THE REVIEW REPRODUCED: item_data.cost = {value, source, at} — lib/item-cost.js's own
 * "must never reach a customer-facing surface" shape. */
const ITEM_ROW = { item_id: ITEM_ID, created_at: '2026-09-01T00:00:00Z',
  item_data: { name: 'Widget', price: 500, cost: { value: 380, source: 'manual', at: '2026-09-01' } } };

function deps({ can_see_cost = false } = {}) {
  const query = async (sql) => {
    if (/catalogue_visibility/.test(sql)) return { rows: [{ catalogue_visibility: 'public' }] };
    if (/FROM entity_schemas/.test(sql)) return { rows: [{ schema_id: 's1', schema_name: 'Products' }] };
    if (/FROM schema_fields/.test(sql)) return { rows: [] };
    /* storefront_access, policy_flags — exposure.exposureOf() reads its business-wide default off this */
    if (/storefront_access, policy_flags FROM identities/.test(sql))
      return { rows: [{ storefront_access: 'browse', policy_flags: can_see_cost ? { show_cost_to_customers: true } : {} }] };
    return { rows: [] };
  };
  const withEntity = async (_e, fn) => fn({ query: async (sql) => {
    if (/catalogue_adoption/.test(sql)) return { rows: [] };
    if (/FROM catalogue_items/.test(sql)) return { rows: [ITEM_ROW] };
    if (/catalogue_face/.test(sql)) return { rows: [] };
    return { rows: [] };
  } });
  const catalogueBuild = { resolve: async (key) => ({ title: 'Templates', collection: 'T', items: [], source_key: key }) };
  return { entity: ENTITY, query, withEntity, catalogueBuild, orderInput, catalogueRead };
}

t('⭐⭐⭐ item_data.cost is stripped from the ITEM — the pre-existing half of the guard, still true', async () => {
  const v = await view.buildPublicView(deps());
  assert.strictEqual(v.items.length, 1);
  assert.strictEqual(v.items[0].item_data.cost, undefined, 'exposure.apply() must still strip the item itself');
});

t('⭐⭐⭐ [REV-04] item_data.cost is ALSO stripped from lines[].fields — the gap the review found', async () => {
  const v = await view.buildPublicView(deps());
  assert.ok(Array.isArray(v.lines) && v.lines.length >= 1, 'expected at least one line built from the owned item');
  const line = v.lines.find((l) => l.item_id === ITEM_ID);
  assert.ok(line, 'the owned item did not produce a line at all');
  assert.strictEqual(line.fields.cost, undefined,
    'cost survived in lines[].fields — this is the exact leak curl https://api/api/catalogue/<bridge_id> proved');
});

t('and everything else on the line survives the strip untouched — this is not a bigger hammer than needed', async () => {
  const v = await view.buildPublicView(deps());
  const line = v.lines.find((l) => l.item_id === ITEM_ID);
  assert.strictEqual(line.fields.name, 'Widget');
  assert.strictEqual(line.fields.price, 500);
});

t('a caller WITH cost visibility still sees it nowhere on the public view — this route has no such switch', async () => {
  // exposure.js's own rule (tests/exposure-cost.test.js): cost has no opt-in switch, unlike price/margin
  // fields that DO have one. Setting an unrelated flag must not accidentally open this one.
  const v = await view.buildPublicView(deps({ can_see_cost: true }));
  const line = v.lines.find((l) => l.item_id === ITEM_ID);
  assert.strictEqual(line.fields.cost, undefined);
  assert.strictEqual(v.items[0].item_data.cost, undefined);
});

(async () => {
  for (const [name, fn] of CASES) {
    try { await fn(); console.log('\x1b[32mok\x1b[0m  ' + name); pass++; }
    catch (e) { console.log('\x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
