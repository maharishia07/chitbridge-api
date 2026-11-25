'use strict';
/**
 * reviews3-catalogue-gates.test.cjs — batch 1129 fixReviews3: goldfish/elephant catalogue-01 findings.
 * OWNS: catalogueVisibility fails closed (M1), definition-check blank-is-not-zero and rate ceilings (M7), applyLiveOffers leaves lines untouched when it throws (M5).
 * CALLED BY scripts/guards.cjs
 * BREAK CASE: before the fix a gate read that threw answered null (open); '' / null rate was a valid 0% slab; percent 150 and rate 1800 passed; a throw after the line pass left discounted lines with the pre-offer total.
 * Run: node tests/reviews3-catalogue-gates.test.cjs
 */
const assert = require('node:assert');
const path = require('node:path');
const stub = (rel, exports) => { const file = require.resolve(path.join('..', rel)); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
let fail = 0;
async function it(name, fn) { try { await fn(); console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n      ' + String(e.message).split('\n')[0]); } }
const { missingValue } = require('../lib/definition-check');
const cv = require('../lib/catalogue-view');
(async () => {
  await it('M1: a timeout on the gate read is private, not open', async () => {
    const v = await cv.catalogueVisibility({ entity_id: 'e', query: async () => { throw new Error('timeout'); }, visibilityCap: null, viewer: null });
    assert.strictEqual(v, 'private');
  });
  await it('M1: the b114 column missing keeps the pre-b114 answer (null)', async () => {
    const v = await cv.catalogueVisibility({ entity_id: 'e', query: async () => { const e = new Error('column "catalogue_visibility" does not exist'); e.code = '42703'; throw e; }, visibilityCap: null, viewer: null });
    assert.strictEqual(v, null);
  });
  await it('M7: an empty or null Rate box is not a 0% slab', () => {
    for (const rate of ['', null, '  ', undefined, false]) assert.ok(missingValue('tax', null, { rate }), 'rate ' + JSON.stringify(rate));
    assert.strictEqual(missingValue('tax', null, { rate: 0 }), null);
    assert.strictEqual(missingValue('tax', null, { rate: '18' }), null);
  });
  await it('M7: rate 1800 and percent 150 are refused', () => {
    assert.ok(missingValue('tax', null, { rate: 1800 }));
    assert.ok(missingValue('offer', 'percent_off', { percent: 150 }));
    assert.strictEqual(missingValue('offer', 'percent_off', { percent: 10 }), null);
  });
  await it('M5: an engine throw after the line pass leaves lines and total as they came in', async () => {
    stub('lib/catalogue-view.js', Object.assign({}, cv, { liveOffers: async () => [{ id: 'o1', label: '10%', kind: 'percent_off', percent: 10, scope: 'line', status: 'live' }] }));
    stub('lib/customer-groups.js', { groupsOf: async () => [], offersFor: (all) => all });
    const real = require('../lib/offers-engine');
    const eng = real.CBOffers; const orig = eng.perLine;
    eng.perLine = () => ({ 0: { off: 40, offer_id: 'o1', label: '10%' } });
    const origEv = eng.evaluate;
    eng.evaluate = (a) => { const r = origEv(a); r.adjustments = [{ scope: 'cart', amount: 5, offer_id: 'o1' }]; r.cart_shares = { 0: 'boom' }; return r; };
    try {
      delete require.cache[require.resolve('../lib/offers-live')];
      const { applyLiveOffers } = require('../lib/offers-live');
      const item = { item_id: 'i1', sku: 'S1', price: 400, quantity: 1, total: 400, kind: 'finish', d: {} };
      const r = await applyLiveOffers({ identity_id: 'e1', currency_code: 'INR' }, [item], 400, { withEntity: async () => null });
      assert.strictEqual(r.total, 400);
      assert.strictEqual(r.items[0].total, 400);
      assert.strictEqual(r.items[0].offer, undefined);
      assert.strictEqual(r.items[0].discount, undefined);
    } finally { eng.perLine = orig; eng.evaluate = origEv; }
  });
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall checks passed');
  process.exit(fail ? 1 : 0);
})();
