/* storefront-offer-ancestors.cjs — AN OFFER ON A PARENT CATEGORY REACHES ITS CHILDREN IN THE SHOP WINDOW TOO. (M40)
 *
 * Backlog, 2026-09-05: "STOREFRONT OFFERS DO NOT YET REACH CHILD CATEGORIES — the storefront matches an offer's
 * category id exactly; compose and the product preview add the ancestors." So "10% off Fruits" showed on the owner's
 * product page and not in the shop window for a product filed under Fruits › Dried Fruits.
 *
 * ⭐ THE REAL ENGINE, THE REAL WALKER: public/engine/offers.js evaluates a basket line whose categories come through
 * catalogue-lines.js's cbCatgAncestors, over categories in the PUBLIC payload's shape ({id, parent}) — and again over
 * the app's definition shape ({definition_id, rules:{parent}}), which core.js now walks through the same function.
 * Plus a wiring check that shop.html sends every offer line through it.
 *
 * Run: node e2e/storefront-offer-ancestors.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + (ok ? 'OK ' : '✗  ') + l + (d ? '  · ' + d : '')); if (!ok) bad++; };

const sb = { console, Date }; sb.window = sb; sb.self = sb; sb.globalThis = sb; vm.createContext(sb);
for (const f of ['engine/money.js', 'engine/offers.js', 'app/catalogue-lines.js']) vm.runInContext(fs.readFileSync(path.join(PUB, f), 'utf8'), sb);
const O = sb.CBOffers, up = sb.cbCatgAncestors;
console.log('── an offer on a parent category reaches its children in the shop window ──');
say('the engine and the walker load', !!(O && O.evaluate && O.perLine && typeof up === 'function'));

const offer = { id: 'f10', kind: 'percent_off', label: '10% off Fruits', percent: 10, applies_to: { category: 'fruits' } };
const offOn = (cats) => {
  const l = { key: 'x', item_id: 'dates', sku: null, excluded: [], qty: 1, unitPrice: 200, categories: cats };
  const ev = O.evaluate({ lines: [l], offers: [offer], ctx: { now: new Date() } });
  return ((O.perLine(ev, [l]) || {}).x || {}).off || 0;
};

/* the public payload's shape — what shop.html's _SHOPDATA.categories carries */
const PUBLIC = [{ id: 'fruits', name: 'Fruits', parent: null }, { id: 'dried', name: 'Dried Fruits', parent: 'fruits' },
                { id: 'loop', name: 'A', parent: 'loop2' }, { id: 'loop2', name: 'B', parent: 'loop' }];
say('⚠️ matched EXACTLY (the old storefront), the child gets nothing', offOn(['dried']) === 0, 'off ' + offOn(['dried']));
const walked = up(['dried'], PUBLIC);
say('walked, the child carries its parent', JSON.stringify(walked) === '["dried","fruits"]', JSON.stringify(walked));
say('⭐ and the parent category\'s offer now applies to it', offOn(walked) === 20, 'off ₹' + offOn(walked));
say('a cycle in the tree stops rather than hangs', JSON.stringify(up(['loop'], PUBLIC)) === '["loop","loop2"]', JSON.stringify(up(['loop'], PUBLIC)));

/* the app's definition shape — core.js's catgWithAncestors walks through the same function now */
const DEFS = [{ definition_id: 'fruits', rules: {} }, { definition_id: 'dried', rules: { parent: 'fruits' } }];
const appWalk = up(['dried'], DEFS, (x) => x && x.rules && x.rules.parent, (x) => x && (x.definition_id || x.id));
say('the same walker reads the app\'s definitions shape', JSON.stringify(appWalk) === '["dried","fruits"]', JSON.stringify(appWalk));

/* wiring — both storefront offer paths go through it, and core.js has no second copy of the walk */
const shop = fs.readFileSync(path.join(PUB, 'shop.html'), 'utf8');
say('shop.html\'s basket lines (_lineOf) carry the parents', /function _lineOf[\s\S]{0,400}categories:\s*_catgUp\(/.test(shop));
say('shop.html\'s network offers (finishDeal) carry the parents', /function finishDeal[\s\S]{0,700}categories:\s*_catgUp\(/.test(shop));
const core = fs.readFileSync(path.join(PUB, 'app', 'core.js'), 'utf8');
say('core.js walks through cbCatgAncestors, with no loop of its own', /return cbCatgAncestors\(\s*out,\s*cats,/.test(core) && !/by\[id\]\.rules\.parent, hops = 0/.test(core));

console.log(bad ? '\n✗ ' + bad + ' failed\n' : '\n✓ all good\n');
process.exit(bad ? 1 : 0);
