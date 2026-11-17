#!/usr/bin/env node
// @type: unit
/**
 * jan-7-method-models.test.cjs — JAN-7 (proof 2026-11-14): METHOD_MODELS (public/app/catalogue-model.js) narrows the order-model pickers by selling method
 * (cart 6 / qty 5 / subscription 3 / text 0), FAILS OPEN on an unknown method, and an orphan is SURFACED with a banner, never hidden or rewritten.
 * The model is require()d as the browser loads it; the picker (cap-definitions.js cbDefSubKinds) is lifted and run on the real model.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node tests/jan-7-method-models.test.cjs
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { sliceFrom, run, ROOT } = require('./lib/proof-lift.cjs');
const CBCatalogue = require('../public/app/catalogue-model.js');

let pass = 0;
const ok = (condition, name) => { assert(condition, name); pass++; console.log('  ok  ' + name); };

// 1. the counts the line names, hand-counted from the table: cart count measure pack range pick offer = 6; qty the same without offer = 5; subscription 3; text 0
ok(CBCatalogue.modelsForMethod('cart').length === 6, 'JAN-7: cart sells 6 order models');
ok(CBCatalogue.modelsForMethod('qty').length === 5 && CBCatalogue.modelsForMethod('qty').indexOf('offer') < 0, 'JAN-7: qty sells 5 (no price, so no offer)');
ok(CBCatalogue.modelsForMethod('subscription').join() === 'count,measure,pack', 'JAN-7: subscription sells 3 fixed shapes');
ok(CBCatalogue.modelsForMethod('text').length === 0, 'JAN-7: a text (information only) catalogue sells 0');

// 2. FAILS OPEN: an unknown or absent method returns every model
const every = ['count', 'measure', 'pack', 'range', 'pick', 'offer'];
ok(CBCatalogue.modelsForMethod('no-such-method').join() === every.join(), 'JAN-7: an unknown method offers EVERY model (fails open)');
ok(CBCatalogue.modelsForMethod(undefined).join() === every.join(), 'JAN-7: an absent method offers every model');
const copy = CBCatalogue.modelsForMethod('cart'); copy.push('x');
ok(CBCatalogue.modelsForMethod('cart').length === 6, 'JAN-7: the answer is a copy (a caller cannot widen the table)');

// 3. the picker narrows by the catalogue's method and offers everything with no method
const code = sliceFrom('public/app/cap-definitions.js', 'function cbDefSubKinds(kind) {', '\n  if (kind === \'offer\')') + '\n}\n';
const pick = (method) => {
  const sandbox = { CBCatalogue, CBCart: { models: { count: 1, measure: 1, pack: 1, range: 1, pick: 1, offer: 1 } }, UI: { catf: method ? { method } : null } };
  run(code + '\nthis.cbDefSubKinds = cbDefSubKinds;', sandbox);
  return sandbox.cbDefSubKinds('ordermodel');
};
ok(pick('cart').length === 6 && pick('qty').length === 5 && pick('subscription').length === 3 && pick('text').length === 0, 'JAN-7: the picker shows 6 / 5 / 3 / 0 for cart / qty / subscription / text');
ok(pick(null).length === 6, 'JAN-7: no method known → the picker offers all 6 (fails open)');

// 4. orphans are reported, never hidden or rewritten
const used = ['count', 'range', 'pick'];
const orphans = CBCatalogue.orphanModels('subscription', used);
ok(orphans.join() === 'range,pick', 'JAN-7: models a method cannot sell are named as orphans');
ok(used.join() === 'count,range,pick', 'JAN-7: reporting an orphan leaves the products\' models untouched');
ok(CBCatalogue.orphanModels('mystery', used).length === 0, 'JAN-7: an unknown method orphans nothing (not provable)');
const setup = fs.readFileSync(path.join(ROOT, 'public/app/cap-catsetup.js'), 'utf8');
ok(/CBCatalogue\.orphanModels\(meth, used\)/.test(setup) && /return orphanNote \+ '<div class="catset-dlist">' \+ list\.map\(row\)\.join\(''\) \+ live\.map\(row\)\.join\(''\)/.test(setup), 'JAN-7: the Definitions list shows the banner AND still lists every definition (live ones included)');
ok(/nothing has been changed or removed/.test(setup), 'JAN-7: the banner says nothing was changed or removed');
console.log(pass + ' passed');
