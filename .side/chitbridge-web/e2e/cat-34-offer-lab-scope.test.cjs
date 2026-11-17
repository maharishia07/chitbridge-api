/**
 * cat-34-offer-lab-scope.test.cjs — CAT-34 (proof 2026-11-14): the Offer Lab "Apply it to" picker keeps a category as a DYNAMIC scope (category:X), never a snapshot of its items.
 * OWNS      the proof on the real code: ruleParamsOf() and engineOfferOf() lifted from public/offer-lab-next.html, judged by the real engine's CBOffers.covers (public/engine/offers.js):
 *           a "whole category" offer saves applies_to = { category: <id> } and NO item_ids; an item added to that category AFTER the offer was saved is still covered, one in another
 *           category is not; an item-by-item offer saves item_ids and covers only those. The same for a saved offer's snapshot (engineOfferOf).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/cat-34-offer-lab-scope.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns, loadScript } = require('./lib/lift-fn.cjs');

const engine = loadScript('public/engine/offers.js');
const S = { goal: 'percent', pctOff: '10', rsOff: '', scope: 'cat', catId: 'def-grains', itemIds: [] };
const sandbox = { console, S };
vm.createContext(sandbox);
vm.runInContext(liftFns('public/offer-lab-next.html', ['num', 'subKindOf', 'ruleParamsOf', 'engineOfferOf']) + '\nthis.ruleParamsOf = ruleParamsOf; this.engineOfferOf = engineOfferOf;', sandbox);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const rice = { item_id: 'rice', category: 'def-grains' }, soap = { item_id: 'soap', category: 'def-home' };
const newGrain = { item_id: 'atta-added-later', category: 'def-grains' };

const rule = sandbox.ruleParamsOf();
ok(rule.percent === 10 && rule.scope === 'line' && JSON.stringify(rule.applies_to) === JSON.stringify({ category: 'def-grains' }), 'a whole-category percent offer saves applies_to = { category: "def-grains" } (' + JSON.stringify(rule.applies_to) + ')');
ok(!('item_ids' in rule.applies_to), 'and no item_ids: the category is not turned into a list of today\'s items');
const offer = { id: 'o1', kind: 'percent_off', percent: rule.percent, scope: 'line', applies_to: rule.applies_to };
ok(engine.CBOffers.covers(offer, rice) === true, 'it covers rice (in Grains)');
ok(engine.CBOffers.covers(offer, newGrain) === true, 'it covers an item added to Grains AFTER the offer was saved (dynamic, not a snapshot)');
ok(engine.CBOffers.covers(offer, soap) === false, 'it does not cover soap (another category)');
const saved = sandbox.engineOfferOf({ id: 'o1', snap: Object.assign({}, S) });
ok(JSON.stringify(saved.applies_to) === JSON.stringify({ category: 'def-grains' }) && saved.kind === 'percent_off', 'a saved offer read back keeps the category scope (' + JSON.stringify(saved.applies_to) + ')');
Object.assign(S, { scope: 'item', itemIds: ['rice'] });
const byItem = sandbox.ruleParamsOf();
ok(JSON.stringify(byItem.applies_to) === JSON.stringify({ item_ids: ['rice'] }), 'item-by-item saves item_ids only (' + JSON.stringify(byItem.applies_to) + ')');
const itemOffer = { id: 'o2', kind: 'percent_off', percent: 10, scope: 'line', applies_to: byItem.applies_to };
ok(engine.CBOffers.covers(itemOffer, rice) === true && engine.CBOffers.covers(itemOffer, newGrain) === false, 'an item-picked offer covers only the picked item, not a later one in the same category');
process.exitCode = bad ? 1 : 0;
