/**
 * one-figure-cash.test.cjs - ONE-FIGURE RC9 (28 Nov 2026, drift exit): which ledgers ARE cash is typed ONCE (lib/cash-roles.js, docs/one-figure/cash-roles.json).
 *  - the golden: CASH_ROLES = cash bank upi card, MONEY_ROLES adds bank_od - the sets the four old hand lists held (books-cashflow, books-store, books-period-taxed, folder-inventory), proven equal as sets.
 *  - every reader holds THE list (same array, not a copy); the receipts folder names the other three.
 *  - the scan: a list of three or more cash roles typed side by side outside the owner (and the dated waivers) fails; SCAN_SELFTEST=1 plants one and must fail.
 * Run: node tests/one-figure-cash.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(API, 'docs', 'one-figure', 'cash-roles.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const Cash = require(path.join(API, 'lib', 'cash-roles'));
ok('golden: CASH_ROLES is cash bank upi card (the set every old list held)', same(Cash.CASH_ROLES, ['cash', 'bank', 'upi', 'card']));
ok('golden: MONEY_ROLES is those plus bank_od', same(Cash.MONEY_ROLES, ['cash', 'bank', 'upi', 'card', 'bank_od']));
ok('the lists cannot be edited by a reader (frozen)', Object.isFrozen(Cash.CASH_ROLES) && Object.isFrozen(Cash.MONEY_ROLES));
ok('the cash view reads THE list', require(path.join(API, 'lib', 'books-cashflow')).CASH_ROLES === Cash.CASH_ROLES);
ok('the tax settlement reads THE money list', require(path.join(API, 'lib', 'books-period-taxed')).MONEY_ROLES === Cash.MONEY_ROLES);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const RUN = /['"](?:cash|bank|upi|card)['"]\s*,\s*['"](?:cash|bank|upi|card)['"]\s*,\s*['"](?:cash|bank|upi|card)['"]/;
const files = [];
const walk = (rel) => { const abs = path.join(API, rel); if (!fs.existsSync(abs)) return; for (const f of fs.readdirSync(abs)) { const r = rel + '/' + f; if (fs.statSync(path.join(API, r)).isDirectory()) { if (f !== 'node_modules') walk(r); } else if (f.endsWith('.js')) files.push(r); } };
['lib', 'routes', 'middleware', 'scripts', 'src'].forEach(walk);
const waived = (rel) => rel === 'lib/cash-roles.js' || rel === 'lib/chits-input.js' || /^lib\/reg-[a-z]+\.js$/.test(rel) || rel === 'lib/tax-engine.browser.js';
const hits = [];
files.concat(process.env.SCAN_SELFTEST ? ['selftest.js'] : []).forEach((rel) => {
  if (waived(rel)) return;
  const text = rel === 'selftest.js' ? "const MINE = ['cash', 'bank', 'upi'];" : strip(fs.readFileSync(path.join(API, rel), 'utf8'));
  if (RUN.test(text)) hits.push(rel);
});
ok('no second hand-typed list of the cash roles outside ' + spec.owner + ' (' + spec.waivers.length + ' dated waivers)', hits.length === 0, 'second list in ' + hits.join(' '));
if (!process.env.ONE_FIGURE_INNER) ok('MUTATION: a planted second list turns the scan red', require('child_process').spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { SCAN_SELFTEST: '1', ONE_FIGURE_INNER: '1' }), encoding: 'utf8', windowsHide: true }).status === 1);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
