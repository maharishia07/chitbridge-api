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

/* ⭐⭐⭐ P1 HOTFIX 2026-10-29 (leak hammer): item_data.unit_cost = 7777.77 and supplier_note went to ANYONE — the stripper dropped only `cost`.
 * Every buying-side key below must be absent from the WHOLE public answer (items, lines[].fields, detail, anywhere) whoever asks:
 * anonymous / stranger / partner / cost-blind / viewer all get the one public payload (asOwner:false, no switch), and an owner reading his own too. */
const COST_SIDE_KEYS = { cost: { value: 380 }, unit_cost: 7777.77, landed_cost: 7001.11, purchase_cost: 6001.11, purchase_price: 5001.11, last_cost: 4001.11,
  avg_cost: 3001.11, buy_price: 2001.11, buying_cost: 1001.11, supplier_note: 'SECRET-SUPPLIER-NOTE', supplier_name: 'SECRET-SUPPLIER', supplier_price: 901.11,
  vendor_note: 'SECRET-VENDOR-NOTE', margin: 41.11, margin_pct: 42.22, markup: 43.33, cogs: 44.44, gross_profit: 45.55,
  variants: [{ name: 'L', unit_cost: 8888.88, supplier_note: 'SECRET-NESTED' }] };
const SECRETS = ['7777.77', '7001.11', '6001.11', '5001.11', '4001.11', '3001.11', '2001.11', '1001.11', '901.11', '8888.88', '41.11', '42.22', '43.33', '44.44', '45.55',
  'SECRET-SUPPLIER', 'SECRET-VENDOR', 'SECRET-NESTED', 'unit_cost', 'supplier_note', 'landed_cost', 'purchase_price', 'margin', 'markup', 'cogs'];
const SEEDED = Object.assign({}, ITEM_ROW, { item_data: Object.assign({ name: 'Widget', price: 500, mrp: 550, unit: 'pc' }, COST_SIDE_KEYS) });
const seededDeps = (opts) => { const d = deps(opts); const w = d.withEntity;
  d.withEntity = async (e, fn) => w(e, (db) => fn({ query: async (sql) => (/FROM catalogue_items/.test(sql) ? { rows: [SEEDED] } : db.query(sql)) }));
  return d; };
for (const [who, o] of [['anonymous / stranger / partner / cost-blind / viewer (the one public payload)', {}], ['an owner reading his own catalogue (asOwner)', { asOwner: true }], ['a shop whose cost flag is on', { can_see_cost: true }]]) {
  t('⭐⭐⭐ [P1] no buying-side key or value anywhere in the answer — ' + who, async () => {
    const v = await view.buildPublicView(Object.assign(seededDeps(o), o.asOwner ? { asOwner: true } : {}));
    const wire = JSON.stringify(v);
    SECRETS.forEach((s) => assert.ok(!wire.includes(s), 'the public answer carries ' + s));
    const line = v.lines.find((l) => l.item_id === ITEM_ID);
    assert.strictEqual(line.fields.name, 'Widget'); assert.strictEqual(line.fields.price, 500);
    assert.strictEqual(line.fields.mrp, 550); assert.strictEqual(v.items[0].item_data.unit, 'pc');
  });
}
t('[P1] fail-closed: the ONE list (lib/cost.js COST_KEYS) refuses the buying side and spares what a customer reads', () => {
  const cost = require('../lib/cost');
  Object.keys(COST_SIDE_KEYS).filter((k) => k !== 'variants').forEach((k) => assert.ok(cost.isCostKey(k), k + ' must be a cost key'));
  ['name', 'price', 'mrp', 'unit', 'description', 'category', 'hsn', 'costume', 'cost_hidden', 'discount', 'sku'].forEach((k) => assert.ok(!cost.isCostKey(k), k + ' is not a cost key'));
});
t('[P1] a cost-allowed reader is byte-identical: products.js strips only for a cost-blind caller, so the Labs still read unit_cost', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../routes/products.js'), 'utf8');
  assert.ok(src.includes('if (!(await safeCanSeeCosts(req, entity_id))) stripCosts(items);'), 'the cost-blind-only guard on the product list changed');
});

(async () => {
  for (const [name, fn] of CASES) {
    try { await fn(); console.log('\x1b[32mok\x1b[0m  ' + name); pass++; }
    catch (e) { console.log('\x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
