#!/usr/bin/env node
// @type: contract
/**
 * assist-resolve-retired-gone.test.cjs — API-49: the retired POST /api/assist/resolve (it only ever answered 410) is deleted, and nothing still names it.
 *
 * OWNS      the proof that the route is gone from the app, its contract row, its register row and the hand files that listed it; GET /api/assist/resolve (the live region read) is untouched.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the app is loaded offline.
 * FLOW      tools/load-app.cjs → the app's OpenAPI operations → the router source (ASSIST_ROUTE overrides the file, for the mutation check) → the register and the hand files.
 * CARD      28-platform-and-operations/api-standard
 *
 * Hand-computed expectation: operations of the assist mount lose exactly one key, 'POST /api/assist/resolve'; 'GET /api/assist/resolve' stays; the router file has no router.post('/resolve');
 * docs/api-register.json has no row with that key and still has the GET row; the strict-input scope file has no entry for it.
 *
 *   node tests/assist-resolve-retired-gone.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'tools', 'load-app.cjs')).loadApp(ROOT);
const register = require(path.join(ROOT, 'tools', 'api-register.cjs'));

const RETIRED = 'POST /api/assist/resolve';
const LIVE = 'GET /api/assist/resolve';
let bad = 0;
const check = (label, pass, extra) => {
  if (!pass) bad++;
  console.log((pass ? 'ok   ' : 'FAIL ') + label + (pass ? '' : ' :: ' + JSON.stringify(extra)));
};
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

const operations = register.operationsOfApp();
check('the app no longer declares ' + RETIRED, !Object.prototype.hasOwnProperty.call(operations, RETIRED), Object.keys(operations).filter((key) => /assist\/resolve/.test(key)));
check('the live region read ' + LIVE + ' is still declared', Object.prototype.hasOwnProperty.call(operations, LIVE));

const routeFile = process.env.ASSIST_ROUTE || 'routes/assist.js';
const source = fs.readFileSync(path.join(ROOT, routeFile), 'utf8');
check('routes/assist.js registers no router.post(\'/resolve\'', !/router\.post\(\s*['"]\/resolve['"]/.test(source));
check('routes/assist.js still registers router.get(\'/resolve\'', /router\.get\(\s*['"]\/resolve['"]/.test(source));

const rows = readJson('docs/api-register.json').routes || readJson('docs/api-register.json').rows || [];
const keys = rows.map((row) => row.key);
check('docs/api-register.json has no row for ' + RETIRED, !keys.includes(RETIRED));
check('docs/api-register.json still has the row ' + LIVE, keys.includes(LIVE), keys.length);
check('docs/API-REGISTER.md has no ' + RETIRED + ' row', !fs.readFileSync(path.join(ROOT, 'docs', 'API-REGISTER.md'), 'utf8').includes('| POST | /api/assist/resolve |'));

const scope = readJson('docs/contracts/api-hardening-scope.json');
check('the hardening scope file lists no ' + RETIRED, !JSON.stringify(scope).includes(RETIRED));

process.exit(bad ? 1 : 0);
