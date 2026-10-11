/**
 * tests/showcase-policy.test.cjs — S2: the shop's chosen showcase template is ONE policy flag, derived from the registry.
 *   1  showcase_template's options are exactly the showcase.* rows of data/pages.json; the default is the first (gallery)
 *   2  an unregistered template / a junk section list is refused (coerce → undefined); a registered one and a real subset pass; [] is refused
 *   3  the public catalogue view carries shop.showcase from the policy_flags it already reads (no extra trip)
 * Run: node tests/showcase-policy.test.cjs   · no DB, no network.
 */
'use strict';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const fs = require('fs'), path = require('path');
const policy = require('../lib/policy');
let pass = 0, fail = 0;
const ok = (n, c, w) => { if (c) { pass++; console.log('   ok   ' + n); } else { fail++; console.log('   FAIL ' + n + (w ? '\n          ' + w : '')); } };
const reg = require('../data/pages.json').pages.filter((r) => r.name.startsWith('showcase.')).map((r) => r.name + '@' + r.version);
ok('four showcase rows registered', reg.length === 4, reg.join());
ok('options = the registry\'s showcase rows', JSON.stringify(policy.FLAGS.showcase_template.options) === JSON.stringify(reg));
ok('default is the gallery seed', policy.defaults().showcase_template === 'showcase.designer.gallery@1.0' && Array.isArray(policy.defaults().showcase_sections));
ok('every registered template is accepted', reg.every((n) => policy.coerce('showcase_template', n) === n));
ok('an unregistered or junk template is refused', policy.coerce('showcase_template', 'showcase.x.y@1.0') === undefined && policy.coerce('showcase_template', 'chit.base.detail@1.0') === undefined && policy.coerce('showcase_template', { a: 1 }) === undefined);
ok('sections: a real subset passes, junk is dropped, [] and non-arrays refused', JSON.stringify(policy.coerce('showcase_sections', ['strip', 'nope', 'menu'])) === '["strip","menu"]' && policy.coerce('showcase_sections', []) === undefined && policy.coerce('showcase_sections', 'strip') === undefined);
const view = fs.readFileSync(path.join(__dirname, '..', 'lib', 'catalogue-view.js'), 'utf8');
ok('the public view carries shop.showcase from entityFlags (already read)', /showcase: \{ template: \(entityFlags && entityFlags\.showcase_template\)/.test(view));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
