'use strict';
/**
 * offers-live-line-categories.test.cjs — api adopt of engines #131 (CBOffers.lineCategories).
 * OWNS: the categories applyLiveOffers (lib/offers-live.js) hands the offers engine for each line: read through CBOffers.lineCategories, nothing else.
 * CALLED BY tests/run list (package.json), the adopt/engines-release-2026-11-14 PR.
 * BREAK CASE: with the caller's old `[].concat(d.categories, name).map(String)` a blank in categories[] reached the engine as '' and (before this PR) an own line's single
 * `category` was never read; the third scenario fails if lineCategories ever starts reading the own line's `category` or the line's category_ids here.
 * Expected figures are hand-computed: 10% of 3 x 60.00 = 180.00 is 18.00 off.
 * Run: node tests/offers-live-line-categories.test.cjs
 */
const assert = require('node:assert');
const path = require('node:path');
const stub = (rel, exports) => {
  const file = require.resolve(path.join('..', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const OFFER = { id: 'o1', label: '10% Drinks', kind: 'percent_off', percent: 10, scope: 'line', applies_to: { category: 'Drinks' }, status: 'live' };
stub('lib/catalogue-view.js', { liveOffers: async () => [OFFER] });
stub('lib/customer-groups.js', { groupsOf: async () => [], offersFor: (all) => all });
const { applyLiveOffers } = require('../lib/offers-live');
const entity = { identity_id: 'e1', currency_code: 'INR' };
const line = (d, extra) => Object.assign({ item_id: 'i1', sku: 'S1', price: 60, quantity: 3, total: 180, kind: 'finish', d }, extra || {});
const off = async (item) => ((await applyLiveOffers(entity, [item], 180, { withEntity: async () => null })).items[0].offer || {}).off || 0;
let fail = 0;
async function it(name, fn) {
  try { await fn(); console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + String(e.message).split('\n')[0]); }
}
(async () => {
  await it('a line with categories[] holding the offer category (and a blank) is 18.00 off', async () => assert.strictEqual(await off(line({ categories: ['', 'Drinks'] })), 18));
  await it('a line with no category the offer names is untouched', async () => assert.strictEqual(await off(line({ categories: ['Snacks'] })), 0));
  await it('an own line carrying only the single `category` name is untouched, as before the adopt (a network line adds its name, an own line does not)', async () =>
    assert.strictEqual(await off(line({ category: 'Drinks' })), 0));
  await it('a line carrying category_ids only is untouched here (the api sends categories[] only; engines #131 reads ids when a caller sends them)', async () =>
    assert.strictEqual(await off(line({ category_ids: ['Drinks'] })), 0));
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall checks passed');
  process.exit(fail ? 1 : 0);
})();
