'use strict';
/**
 * tests/cost-margin-basis.test.cjs — THE OWNER'S CHIT MARGIN IS ON THE TAXABLE VALUE (ACC-206 C1; R29 in the reader audit; RULE-MATRIX f7).
 *
 * Tax is not income, so margin = taxable − cost. Before C1 lib/cost.js read the detail column (the engine's tax-in TOTAL on every chit
 * since 2 Nov) and showed 89 for a 180 + 9 invoice that cost 100. The figure is PICKED from the chit (counter-bill.taxableOf), never
 * worked out from the lines; one case per matrix column in tests/lib/bill-total-fixtures.cjs. Offline: the database is a stand-in.
 */
const path = require('path');
const assert = require('assert');
const { FIXTURES } = require('./lib/bill-total-fixtures.cjs');
const root = path.join(__dirname, '..');
const CHIT = '11111111-1111-4111-8111-111111111111', SHOP = '22222222-2222-4222-8222-222222222222';
const dbPath = require.resolve(path.join(root, 'db'));
let fixture = null, cost = 0;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  withEntity: async (_entity, work) => work({ query: async (sql) => {
    if (/FROM chit_line_cost/.test(sql)) return { rows: cost ? [{ cost_id: 'c1', kind: 'material', amount: cost, currency: 'INR', created_at: 1 }] : [] };
    const row = { total_value: fixture.detail_total, currency_code: 'INR', summary_json: fixture.summary, business_json: null };
    return { rows: [row] };
  } })
} };
const costLib = require(path.join(root, 'lib', 'cost'));
const counterBill = require(path.join(root, 'lib', 'counter-bill'));

/** hand figures: [fixture id, cost, margin, pct]; null margin = unknown, never 0 */
const HAND = {
  'counter-bill': [600, 400, 40], 'b2b-new': [100, 80, 44.44], 'b2b-pre-2-nov': [100, 80, 44.44], 'money-net-only': [100, 80, 44.44],
  'pre-7-sep': [100, 80, 44.44], withheld: [100, null, null], 'no-money': [100, null, null], 'credit-note': [0, -1180, 100]
};

(async () => {
  const lines = [];
  let failed = 0;
  for (const fx of FIXTURES) {
    fixture = fx;
    cost = HAND[fx.id][0];
    const got = await costLib.read(SHOP, CHIT, { permitted: true });
    const [, margin, pct] = HAND[fx.id];
    lines.push(fx.id.padEnd(15) + ' cost ' + String(cost).padStart(4) + '  margin ' + String(got.margin).padStart(6) + ' (want ' + margin + ')  pct ' + got.margin_pct + ' (want ' + pct + ')');
    try { assert.strictEqual(got.margin, margin, fx.id + ' margin'); assert.strictEqual(got.margin_pct, pct, fx.id + ' pct'); } catch (e) { failed += 1; lines.push('   FAIL ' + e.message); }
  }
  console.log(lines.join('\n'));
  /* the lifted pick: one helper, the till's billMoney calls it */
  try {
    assert.strictEqual(typeof counterBill.taxableOf, 'function', 'counter-bill.taxableOf exists');
    for (const fx of FIXTURES) if (fx.summary.money) assert.strictEqual(counterBill.taxableOf(fx.summary), fx.summary.oversight ? fx.summary.money.taxable : fx.taxable, fx.id + ' taxableOf');
    assert.strictEqual(counterBill.taxableOf({}), null, 'no money → null');
    const till = require('fs').readFileSync(path.join(root, 'routes', 'till.js'), 'utf8');
    assert.ok(/counterBill\.taxableOf\(|taxableOf\(row\.summary_json\)/.test(till), 'till.js billMoney calls taxableOf');
    assert.ok(!/money\.taxable != null \? money\.taxable : money\.net/.test(till), 'till.js holds no second copy of the pick');
  } catch (e) { failed += 1; console.log('FAIL ' + e.message); }
  console.log(failed ? failed + ' FAILED' : 'cost-margin-basis: all ' + FIXTURES.length + ' columns pass');
  process.exit(failed ? 1 : 0);
})();
